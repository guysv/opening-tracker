type MainContentProps = {
  status: string;
};

export function MainContent({ status }: MainContentProps) {
  return (
    <main class="content">
      <h1>Ready to import games</h1>
      <p>Choose a user from the sidebar to import the latest archive.</p>
      <p>{status}</p>
    </main>
  );
}
