import { useState } from 'react'
import  { useItems, useSyncEngine } from './sync-engine'

function App() {
  const {items: todos, createItem, updateItem, deleteItem} = useItems('Todo');
  const [newTodoTitle, setNewTodoTitle] = useState('');
  const {loading} = useSyncEngine();
  if (loading) {
    return <div>Loading...</div>;
  }

  // Create new todo
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!newTodoTitle.trim()) return;
    await createItem({
      title: newTodoTitle,
      completed: false
    });
    setNewTodoTitle('');
  };

  // Toggle todo completion
  const handleToggle = async (todo) => {
    await updateItem(todo.id, {
      ...todo.data,
      completed: !todo.data.completed
    });
  };

  // Delete todo
  const handleDelete = async (todo) => {
    await deleteItem(todo.id);
  };

  return (
    <div className="container mx-auto p-4 max-w-md">
      <h1 className="text-2xl font-bold mb-4">Todos</h1>

      {/* Add todo form */}
      <form onSubmit={handleSubmit} className="mb-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={newTodoTitle}
            onChange={(e) => setNewTodoTitle(e.target.value)}
            placeholder="What needs to be done?"
            className="flex-1 px-3 py-2 border rounded"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Add
          </button>
        </div>
      </form>

      {/* Todo list */}
      <ul className="space-y-2">
        {todos.map(todo => (
          <li
            key={todo.id}
            className="flex items-center gap-2 p-2 border rounded"
          >  
            <input
              type="checkbox"
              checked={todo.data.completed}
              onChange={() => handleToggle(todo)}
              className="w-5 h-5"
            />
            <span className={`flex-1 ${todo.data.completed ? 'line-through text-gray-500' : ''}`}>
              {JSON.stringify(todo.data.title)}
            </span>
            <button
              onClick={() => handleDelete(todo)}
              className="px-2 py-1 text-red-500 hover:text-red-600"
            >
              Delete
            </button> 
          </li>
        ))}
      </ul>
    </div>
  );
}

export default App
