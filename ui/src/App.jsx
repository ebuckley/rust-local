import { useState } from 'react'
import { useItems, useSyncEngine } from './sync-engine'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { useToast } from "@/hooks/use-toast"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"

function App() {
  const { items: todos, createItem, updateItem, deleteItem } = useItems('Todo');
  const [newTodoTitle, setNewTodoTitle] = useState('');
  const { loading } = useSyncEngine();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Create new todo
  const handleSubmit = async (e) => {
    e.preventDefault();
    const title = newTodoTitle.trim();
    if (!title) return;
    
    setIsSubmitting(true);
    try {
      await createItem({
        title,
        completed: false,
        createdAt: new Date().toISOString(),
      });
      setNewTodoTitle('');
      toast({
        title: "Todo created",
        description: "Your new todo has been added successfully.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to create todo. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Toggle todo completion
  const handleToggle = async (todo) => {
    try {
      await updateItem(todo.id, {
        ...todo.data,
        completed: !todo.data.completed,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to update todo. Please try again.",
      });
    }
  };

  // Delete todo
  const handleDelete = async (todo) => {
    try {
      await deleteItem(todo.id);
      toast({
        title: "Todo deleted",
        description: "Your todo has been deleted successfully.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to delete todo. Please try again.",
      });
    }
  };

  // Handle keyboard shortcuts
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      handleSubmit(e);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 max-w-md">
      <h1 className="scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl mb-8">
        Todos
      </h1>

      {/* Add todo form */}
      <form onSubmit={handleSubmit} className="mb-6 space-y-4">
        <div className="flex gap-2">
          <Input
            type="text"
            value={newTodoTitle}
            onChange={(e) => setNewTodoTitle(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="What needs to be done?"
            className="flex-1"
            disabled={isSubmitting}
            aria-label="New todo title"
          />
          <Button 
            type="submit" 
            disabled={isSubmitting || !newTodoTitle.trim()}
            aria-label="Add todo"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            <span className="ml-2">Add</span>
          </Button>
        </div>
      </form>

      {/* Todo list */}
      {todos.length === 0 ? (
        <p className="text-center text-muted-foreground">No todos yet. Add one above!</p>
      ) : (
        <ul className="space-y-2" role="list">
          {todos.map(todo => (
            <li
              key={todo.id}
              className={cn(
                "flex items-center gap-3 p-3 border rounded-lg transition-colors",
                "hover:bg-muted/50"
              )}
            >
              <Checkbox
                checked={todo.data.completed}
                onCheckedChange={() => handleToggle(todo)}
                aria-label={`Mark "${todo.data.title}" as ${todo.data.completed ? 'incomplete' : 'complete'}`}
              />
              <span 
                className={cn(
                  "flex-1",
                  todo.data.completed && "line-through text-muted-foreground"
                )}
              >
                {todo.data.title}
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleDelete(todo)}
                aria-label={`Delete "${todo.data.title}"`}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default App
