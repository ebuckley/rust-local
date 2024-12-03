use actix_web::{web, App, HttpResponse, HttpServer, Responder};
use actix_files::Files;
use rusqlite::{Connection, Result, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Mutex;
use chrono::Utc;
use log::{info, warn};
use actix_web::middleware::Logger;

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Transaction {
    #[serde(rename = "type")]
    model_type: String,
    id: String,
    action: String,
    data: Value,
}

#[derive(Debug, Serialize, Deserialize)]
struct TransactionResponse {
    sync_id: i64,
}

#[derive(Debug, Serialize, Deserialize)]
struct TransactionsResponse {
    sync_id: i64,
    transactions: Vec<Transaction>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ModelData {
    id: String,
    data: Value,
}

#[derive(Debug, Serialize, Deserialize)]
struct BootstrapResponse {
    sync_id: i64,
    models: std::collections::HashMap<String, Vec<ModelData>>,
}

struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    fn new(path : &str) -> Result<Self> {
        let conn = Connection::open(path)?;
        
        // Create tables
        conn.execute(
            "CREATE TABLE IF NOT EXISTS sync_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                actions TEXT NOT NULL
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS model_data (
                id TEXT PRIMARY KEY,
                model_name TEXT NOT NULL,
                data TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )?;

        Ok(Database { conn: Mutex::new(conn) })
    }

    fn apply_transactions(&self, transactions: Vec<Transaction>) -> Result<i64> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        
        // Store the transactions in sync_history
        let actions_json = serde_json::to_string(&transactions).unwrap();
        tx.execute(
            "INSERT INTO sync_history (actions) VALUES (?1)",
            params![actions_json],
        )?;
        
        let sync_id = tx.last_insert_rowid();
        
        // Apply each transaction to model_data
        for transaction in transactions {
            let now = Utc::now().timestamp();
            
            match transaction.action.as_str() {
                "create" | "update" => {
                    let data_json = serde_json::to_string(&transaction.data).unwrap();
                    tx.execute(
                        "INSERT OR REPLACE INTO model_data (id, model_name, data, created_at, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5)",
                        params![
                            transaction.id,
                            transaction.model_type,
                            data_json,
                            now,
                            now
                        ],
                    )?;
                },
                "delete" => {
                    tx.execute(
                        "DELETE FROM model_data WHERE id = ?1",
                        params![transaction.id],
                    )?;
                },
                _ => return Err(rusqlite::Error::InvalidParameterName(
                    format!("Invalid action: {}", transaction.action)
                )),
            }
        }
        
        tx.commit()?;
        Ok(sync_id)
    }

    fn get_transactions(&self, from: i64, to: i64) -> Result<(i64, Vec<Transaction>)> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, actions FROM sync_history WHERE id >= ?1 AND id <= ?2"
        )?;
        
        let mut transactions = Vec::new();
        let mut max_sync_id = 0;
        
        let rows = stmt.query_map(params![from, to], |row| {
            let sync_id: i64 = row.get(0)?;
            let actions: String = row.get(1)?;
            Ok((sync_id, actions))
        })?;

        for row in rows {
            let (sync_id, actions) = row?;
            max_sync_id = sync_id;
            let batch: Vec<Transaction> = serde_json::from_str(&actions).unwrap();
            transactions.extend(batch);
        }

        Ok((max_sync_id, transactions))
    }

    fn get_bootstrap_data(&self) -> Result<(i64, std::collections::HashMap<String, Vec<ModelData>>)> {
        let conn = self.conn.lock().unwrap();
        
        // Get the latest sync_id
        let sync_id: i64 = conn.query_row(
            "SELECT COALESCE(MAX(id), 0) FROM sync_history",
            [],
            |row| row.get(0),
        )?;

        // Get all model data
        let mut stmt = conn.prepare(
            "SELECT id, model_name, data FROM model_data"
        )?;
        
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?;

        let mut models: std::collections::HashMap<String, Vec<ModelData>> = std::collections::HashMap::new();
        
        for row in rows {
            let (id, model_name, data_str) = row?;
            let data: Value = serde_json::from_str(&data_str).unwrap();
            
            models.entry(model_name)
                .or_insert_with(Vec::new)
                .push(ModelData { id, data });
        }

        Ok((sync_id, models))
    }
}

async fn post_transactions(
    db: web::Data<Database>,
    transactions: web::Json<Vec<Transaction>>,
) -> impl Responder {
    match db.apply_transactions(transactions.into_inner()) {
        Ok(sync_id) => HttpResponse::Ok().json(TransactionResponse { sync_id }),
        Err(e) => HttpResponse::InternalServerError().body(e.to_string()),
    }
}

async fn get_transactions(
    db: web::Data<Database>,
    query: web::Query<std::collections::HashMap<String, i64>>,
) -> impl Responder {
    let from = query.get("from").copied().unwrap_or(0);
    let to = query.get("to").copied().unwrap_or(i64::MAX);
    
    match db.get_transactions(from, to) {
        Ok((sync_id, transactions)) => {
            HttpResponse::Ok().json(TransactionsResponse {
                sync_id,
                transactions,
            })
        },
        Err(e) => HttpResponse::InternalServerError().body(e.to_string()),
    }
}

async fn get_bootstrap(
    db: web::Data<Database>,
) -> impl Responder {
    match db.get_bootstrap_data() {
        Ok((sync_id, models)) => {
            HttpResponse::Ok().json(BootstrapResponse {
                sync_id,
                models,
            })
        },
        Err(e) => HttpResponse::InternalServerError().body(e.to_string()),
    }
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    env_logger::init_from_env(env_logger::Env::new().default_filter_or("info"));
    
    let db_path = std::env::var("DATABASE_PATH").unwrap_or_else(|_| "windsurf.db".to_string());
    let ui_path = std::env::var("UI_PATH").unwrap_or_else(|_| "../ui/dist".to_string());
    
    info!("Starting server with database at: {}", db_path);
    info!("UI path set to: {}", ui_path);
    
    let db = web::Data::new(Database::new(&db_path).unwrap());
    
    let server = HttpServer::new(move || {
        App::new()
            .app_data(db.clone())
            .wrap(Logger::new("%a '%r' %s %b '%{Referer}i' '%{User-Agent}i' %T"))
            .service(
                web::scope("/api")
                    .route("/transactions", web::post().to(post_transactions))
                    .route("/transactions", web::get().to(get_transactions))
                    .route("/bootstrap", web::get().to(get_bootstrap))
            )
            .service(Files::new("/", &ui_path).index_file("index.html"))
    })
    .bind("0.0.0.0:8080")?;
    
    info!("Server starting on http://0.0.0.0:8080");
    server.run().await
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{test, web, App};
    use tempfile::tempdir;
    use uuid::Uuid;

    async fn setup_test_app() -> (web::Data<Database>, String) {
        let temp_dir = tempdir().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db_path_str = db_path.to_str().unwrap().to_string();
        
        let db = web::Data::new(Database::new(&db_path_str).expect("Failed to create test database"));
        (db, db_path_str)
    }

    #[actix_rt::test]
    async fn test_post_transactions() {
        let (db, _) = setup_test_app().await;
        
        let app = test::init_service(
            App::new()
                .app_data(db.clone())
                .route("/api/transactions", web::post().to(post_transactions))
        ).await;

        let transaction = Transaction {
            model_type: "Todo".to_string(),
            id: Uuid::new_v4().to_string(),
            action: "create".to_string(),
            data: serde_json::json!({
                "title": "Test todo",
                "completed": false
            }),
        };

        let req = test::TestRequest::post()
            .uri("/api/transactions")
            .set_json(vec![transaction])
            .to_request();

        let resp: TransactionResponse = test::call_and_read_body_json(&app, req).await;
        assert!(resp.sync_id > 0);
    }

    #[actix_rt::test]
    async fn test_get_transactions() {
        let (db, _) = setup_test_app().await;
        
        let app = test::init_service(
            App::new()
                .app_data(db.clone())
                .route("/api/transactions", web::post().to(post_transactions))
                .route("/api/transactions", web::get().to(get_transactions))
        ).await;

        // First create a transaction
        let transaction = Transaction {
            model_type: "Todo".to_string(),
            id: Uuid::new_v4().to_string(),
            action: "create".to_string(),
            data: serde_json::json!({
                "title": "Test todo",
                "completed": false
            }),
        };

        let create_req = test::TestRequest::post()
            .uri("/api/transactions")
            .set_json(vec![transaction.clone()])
            .to_request();

        let create_resp: TransactionResponse = test::call_and_read_body_json(&app, create_req).await;
        
        // Then fetch transactions
        let get_req = test::TestRequest::get()
            .uri(&format!("/api/transactions?from=0&to={}", create_resp.sync_id))
            .to_request();

        let get_resp: TransactionsResponse = test::call_and_read_body_json(&app, get_req).await;
        
        assert_eq!(get_resp.transactions.len(), 1);
        assert_eq!(get_resp.transactions[0].id, transaction.id);
    }

    #[actix_rt::test]
    async fn test_bootstrap() {
        let (db, _) = setup_test_app().await;
        
        let app = test::init_service(
            App::new()
                .app_data(db.clone())
                .route("/api/transactions", web::post().to(post_transactions))
                .route("/api/bootstrap", web::get().to(get_bootstrap))
        ).await;

        // Create multiple transactions
        let transactions = vec![
            Transaction {
                model_type: "Todo".to_string(),
                id: Uuid::new_v4().to_string(),
                action: "create".to_string(),
                data: serde_json::json!({
                    "title": "Todo 1",
                    "completed": false
                }),
            },
            Transaction {
                model_type: "Todo".to_string(),
                id: Uuid::new_v4().to_string(),
                action: "create".to_string(),
                data: serde_json::json!({
                    "title": "Todo 2",
                    "completed": true
                }),
            },
        ];

        let create_req = test::TestRequest::post()
            .uri("/api/transactions")
            .set_json(transactions)
            .to_request();

        let _: TransactionResponse = test::call_and_read_body_json(&app, create_req).await;
        
        // Get bootstrap data
        let bootstrap_req = test::TestRequest::get()
            .uri("/api/bootstrap")
            .to_request();

        let bootstrap_resp: BootstrapResponse = test::call_and_read_body_json(&app, bootstrap_req).await;
        
        assert!(bootstrap_resp.sync_id > 0);
        assert!(bootstrap_resp.models.contains_key("Todo"));
        assert_eq!(bootstrap_resp.models["Todo"].len(), 2);
    }

    #[actix_rt::test]
    async fn test_transaction_crud_operations() {
        let (db, _) = setup_test_app().await;
        
        let app = test::init_service(
            App::new()
                .app_data(db.clone())
                .route("/api/transactions", web::post().to(post_transactions))
                .route("/api/bootstrap", web::get().to(get_bootstrap))
        ).await;

        let todo_id = Uuid::new_v4().to_string();
        
        // Test Create
        let create_transaction = Transaction {
            model_type: "Todo".to_string(),
            id: todo_id.clone(),
            action: "create".to_string(),
            data: serde_json::json!({
                "title": "Original todo",
                "completed": false
            }),
        };

        let create_req = test::TestRequest::post()
            .uri("/api/transactions")
            .set_json(vec![create_transaction])
            .to_request();

        let _: TransactionResponse = test::call_and_read_body_json(&app, create_req).await;

        // Test Update
        let update_transaction = Transaction {
            model_type: "Todo".to_string(),
            id: todo_id.clone(),
            action: "update".to_string(),
            data: serde_json::json!({
                "title": "Updated todo",
                "completed": true
            }),
        };

        let update_req = test::TestRequest::post()
            .uri("/api/transactions")
            .set_json(vec![update_transaction])
            .to_request();

        let _: TransactionResponse = test::call_and_read_body_json(&app, update_req).await;

        // Test Delete
        let delete_transaction = Transaction {
            model_type: "Todo".to_string(),
            id: todo_id.clone(),
            action: "delete".to_string(),
            data: serde_json::json!({}),
        };

        let delete_req = test::TestRequest::post()
            .uri("/api/transactions")
            .set_json(vec![delete_transaction])
            .to_request();

        let _: TransactionResponse = test::call_and_read_body_json(&app, delete_req).await;

        // Verify final state
        let bootstrap_req = test::TestRequest::get()
            .uri("/api/bootstrap")
            .to_request();

        let bootstrap_resp: BootstrapResponse = test::call_and_read_body_json(&app, bootstrap_req).await;
        
        // Todo should be deleted
        assert!(bootstrap_resp.models.get("Todo").map_or(true, |todos| 
            !todos.iter().any(|t| t.id == todo_id)
        ));
    }
}
