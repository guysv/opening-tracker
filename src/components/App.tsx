import { MainContent } from "./MainContent";
import { Sidebar } from "./Sidebar";

export function App() {
  function handleImport(username: string, monthsBack: number) {
    console.log({
      username,
      monthsBack,
    });
  }

  return (
    <div class="layout">
      <Sidebar onImport={handleImport} />
      <MainContent />
    </div>
  );
}
