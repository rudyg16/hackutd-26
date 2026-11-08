// OWNER: Person A (3D floor) + side ticket panel slot.
export default function FloorPage() {
  return (
    <div className="grid grid-cols-[1fr_360px] h-[calc(100vh-3rem)]">
      <section className="relative">
        {/* TODO(Person A): <FloorScene /> from components/three */}
        <p className="p-6 text-dim">3D floor goes here.</p>
      </section>
      <aside className="border-l border-line bg-panel p-4">
        {/* TODO(Person B): open-ticket list; clicking flies the camera to the device */}
        {/* TODO(Person C): <ItemDrawer /> when a position is selected */}
        <h2 className="text-neon-amber neon-text mb-2">Open tickets</h2>
      </aside>
    </div>
  );
}
