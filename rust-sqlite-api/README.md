# Rust SQLite REST API

## Overview
This is a simple REST API built with Rust, using Actix Web for the web framework and Rusqlite for SQLite database interactions.

## endpoints
- POST `/transactions`: server gets a set of model transactions Either Create/Update/Delete
  - exampleBody: 
    ```json
    [{
      "type": "Todo",
      "id": "addeadbeef",
      "action": "create",
      "data": {
        "title": "Buy groceries",
        "completed": false
      }
    }]
    ```
  - exampleResponse:
    ```json
    {
      "syncId": 1
    }
    ```

- GET `/transactions?from=1&to=2`: Return a list of model transactions between sync ID's
  - exampleResponse:
    ```json
    {
      "syncId": 1,
      "transactions": [
        {
          "type": "Todo",
          "id": "addeadbeef",
          "action": "create",
          "data": {
            "title": "Buy groceries",
            "completed": false
          }
        }
      ]
    }

- GET `/bootstrap`: Get the state for all the models
  - exampleResponse:
    ```json
    {
      "syncId": 1,
      "models": {
        "Todo": {
          "id": "addeadbeef",
          "data": {
            "title": "Buy groceries",
            "completed": false
          }
        }
      }
    }
    ```


## Schema
```sql
CREATE TABLE IF NOT EXISTS sync_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actions TEXT
    TEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS model_data (
    id TEXT PRIMARY KEY,
    model_name TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
```


## Prerequisites
- Rust (latest stable version)
- Cargo package manager

## Running the Project
1. Clone the repository
2. Navigate to the project directory
3. Run `cargo run`

## API Endpoints
- `POST /users`: Create a new user
  - Request Body: `{ "name": "John Doe", "email": "john@example.com" }`
- `GET /users`: List all users

## Testing the API
You can use curl or Postman to test the endpoints:

### Create a User
```bash
curl -X POST http://localhost:8080/users \
     -H "Content-Type: application/json" \
     -d '{"name": "John Doe", "email": "john@example.com"}'
```

### List Users
```bash
curl http://localhost:8080/users
```

## Dependencies
- actix-web: Web framework
- rusqlite: SQLite database interaction
- serde: JSON serialization/deserialization
