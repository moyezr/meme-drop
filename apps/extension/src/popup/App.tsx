import Library from "./pages/Library";

export default function App() {
  return (
    <div className="w-[400px] min-h-[500px] bg-white">
      <header className="px-4 py-3 border-b border-gray-200">
        <h1 className="text-lg font-bold text-gray-900">MemeDrop</h1>
      </header>
      <main className="p-4">
        <Library />
      </main>
    </div>
  );
}
