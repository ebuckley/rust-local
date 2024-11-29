import { useState, useEffect, useCallback } from "react";
/**
 * SyncEngine is a class that will sync state locally, plus also commit to the server when online again
 * You can also get a stream of state changes to update react
 * State is committed to IDDB for local storage, and to the server asynchronously
 */

// IndexedDB database name and version
const DB_NAME = 'sync_store';
const DB_VERSION = 1;

// Store names
const STORES = {
  MODELS: 'models',
  SYNC: 'sync_state'
};

class SyncEngine {
  constructor() {
    this.db = null;
    this.syncId = 0;
    this.isPolling = false;
    this.pollInterval = 1000; // 1 second
    this.subscribers = new Set();

   
    // Initialize sync engine
  }

  // Initialize IndexedDB and load initial data
  async init() {
    await this.initDb();
    await this.bootstrap();

    this.updateIDDB = this.subscribe((change) => {
      // TODO make this batch a few messages together before persisting to the backend
      this.persistTransactions([change]);
    });

    this.updateBackend = this.subscribe( async (change) => {
      // never batch up a server update to be sent back to the server, only local updates
      if (change.source && change.source === 'server') {
        return; // 
      }
      const response = await fetch('/api/transactions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify([change])
      });

      const { sync_id } = await response.json();
      this.syncId = sync_id;
      await this.setItem(STORES.SYNC, 'syncId', sync_id);

    });

    this.startPolling();
  }

  // Initialize IndexedDB
  async initDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Create models store with id as key
        if (!db.objectStoreNames.contains(STORES.MODELS)) {
          db.createObjectStore(STORES.MODELS, { keyPath: 'id' });
        }
        
        // Create sync state store
        if (!db.objectStoreNames.contains(STORES.SYNC)) {
          db.createObjectStore(STORES.SYNC);
        }
      };
    });
  }

  // Load initial data from server
  async bootstrap() {
    // do not bootstrap if we already have data, it will be updated automatically by the poll
    const currentSyncId = await this.getItem(STORES.SYNC, 'syncId');
    if (currentSyncId) {
      console.log('Already have data, skipping bootstrap');
      this.syncId = currentSyncId;
      return;
    }
    const response = await fetch('/api/bootstrap');
    const { sync_id, models } = await response.json();
    
    this.syncId = sync_id;
    
    // Store sync ID
    await this.setItem(STORES.SYNC, 'syncId', sync_id);
    
    // clear existing data because we're bootstrapping
    const tx = this.db.transaction(STORES.MODELS, 'readwrite');
    const store = tx.objectStore(STORES.MODELS);
    await store.clear();
    
    for (const [modelType, items] of Object.entries(models)) {
      for (const item of items) {
        store.put({ ...item, type: modelType });
      }
    }
    
    await new Promise(resolve => tx.oncomplete = resolve);
    
    // Notify subscribers of initial data
    this.notifySubscribers({ action: 'bootstrap', data: models });
  }

  // Start polling for changes
  startPolling() {
    if (this.isPolling) return;
    this.isPolling = true;
    this.poll();
  }

  // Stop polling
  stop() {
    // also stop all subscribers
    this.subscribers = new Set();
    this.isPolling = false;
  }

  // Poll for changes
  async poll() {
    if (!this.isPolling) return;

    try {
      const response = await fetch(`/api/transactions?from=${this.syncId + 1}`);
      const { sync_id, transactions } = await response.json();
      
      if (transactions.length > 0) {
        for (const transaction of transactions) {
          this.notifySubscribers({source: 'server', ...transaction}); 
        }
        this.syncId = sync_id;
        await this.setItem(STORES.SYNC, 'syncId', sync_id);
      }
    } catch (error) {
      console.error('Polling error:', error);
    }

    setTimeout(() => this.poll(), this.pollInterval);
  }

  // Apply transactions to local store
  async persistTransactions(transactions) {
    const tx = this.db.transaction(STORES.MODELS, 'readwrite');
    const store = tx.objectStore(STORES.MODELS);
    
    for (const transaction of transactions) {
      const { type, id, action, data } = transaction;
      
      switch (action) {
        case 'create':
        case 'update':
          await store.put({ data, id, type });
          break;
        case 'delete':
          await store.delete(id);
          break;
      }
      console.log(
        `Applied ${action} transaction for ${type} with id ${id} and data ${JSON.stringify(data)} to the store`
      )
    }
    
    await new Promise(resolve => tx.oncomplete = resolve);
  }

  // Subscribe to changes
  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  // Notify subscribers of changes
  notifySubscribers(action) {
    for (const callback of this.subscribers) {
      callback(action);
    }
  }

  // Helper to set an item in a store
  async setItem(storeName, key, value) {
    const tx = this.db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.put(value, key);
    await new Promise(resolve => tx.oncomplete = resolve);
  }

  // Helper to get an item from a store
  async getItem(storeName, key) {
    const tx = this.db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const result = await new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return result;
  }

  // Create a new item
  async create(modelType, data) {
    const id = crypto.randomUUID();
    const transaction = {
      type: modelType,
      id,
      action: 'create',
      data
    };
    // Notify subscribers of change
    this.notifySubscribers(transaction);
    return id;
  }

  // Update an existing item
  async update(modelType, id, data) {
    const transaction = {
      type: modelType,
      id,
      action: 'update',
      data
    };
    // Notify subscribers of change
    this.notifySubscribers(transaction);
  }

  // Delete an item
  async delete(modelType, id) {
    const transaction = {
      type: modelType,
      id,
      action: 'delete',
      data: {}
    };

    // Notify subscribers of change
    this.notifySubscribers(transaction);
  }

  // Get all items of a specific type
  async getAll(modelType) {
    const tx = this.db.transaction(STORES.MODELS, 'readonly');
    const store = tx.objectStore(STORES.MODELS);
    const items = await new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return items.filter(item => item.type === modelType);
  }
}

// Create and export a singleton instance
const syncEngine = new SyncEngine();

export default syncEngine;

export function useSyncEngine() {
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    syncEngine.init()
      .then(() => {
        console.log('Sync engine initialized');
        setLoading(false);
      })
  }, []);
  return {
    loading,
    syncEngine
  };
}

export function useItems(modelType) {
  const [items, setItems] = useState([]);
  const {syncEngine, loading} = useSyncEngine();
  useEffect(() => {
    if (loading) return;
    const unsubscribe = syncEngine.subscribe((change) => {
      if (change.type === modelType) {
        syncEngine.getAll(modelType).then(setItems);
      }
    });
    syncEngine.getAll(modelType).then(setItems);
    return unsubscribe;
  }, [loading, modelType]);

  const createItem = useCallback((data) => {
    return syncEngine.create(modelType, data);
  }, [modelType]);

  const updateItem = useCallback((id, updates) => {
    return syncEngine.update(modelType, id, updates);
  }, [modelType]);

  const deleteItem = useCallback((id) => {
    return syncEngine.delete(modelType, id);
  }, [modelType]);

  return {
    items,
    createItem,
    updateItem,
    deleteItem
  };
}

export function useSyncState(modelType, id) {
  const [item, setItem] = useState(null);
  const {syncEngine, loading} = useSyncEngine();
  useEffect(() => {
    if (loading) return;
    const unsubscribe = syncEngine.subscribe((change) => {
      if (change.type === modelType && change.id === id) {
        setItem({
          id: change.id,
          type: change.type,
          data: change.data,
        })
      }
    });
    
    syncEngine.getItem(STORES.MODELS, id).then(setItem);
    return unsubscribe;
  }, [modelType, id, loading]);

  const updateItem = useCallback((updates) => {
    return syncEngine.update(modelType, id, updates);
  }, [modelType, id]);

  return [item, updateItem];
}