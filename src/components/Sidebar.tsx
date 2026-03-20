import { StorageEstimatePanel } from "./StorageEstimatePanel";

type SidebarProps = {
  onImport: (username: string, monthsBack: number) => void;
  onClear: () => void;
};

export function Sidebar({
  onImport,
  onClear,
}: SidebarProps) {
  function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    const username = String(formData.get("username") ?? "").trim();
    const monthsBack = Number(formData.get("monthsBack") ?? 0);

    onImport(username, monthsBack);
  }

  return (
    <aside class="sidebar">
      <h2>Opening Explorer</h2>
      <form class="import-form" onSubmit={handleSubmit}>
        <label class="field">
          <span>chess.com username</span>
          <input
            name="username"
            type="text"
            placeholder="e.g. hikaru"
            required
          />
        </label>

        <label class="field">
          <span>months back</span>
          <input
            name="monthsBack"
            type="number"
            min="1"
            defaultValue="3"
            required
          />
        </label>

        <button type="submit">Import</button>
        <button type="button" onClick={onClear}>
          Clean IndexedDB
        </button>
      </form>

      <StorageEstimatePanel />
    </aside>
  );
}
