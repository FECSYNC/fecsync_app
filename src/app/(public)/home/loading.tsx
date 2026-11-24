export default function HomeLoading() {
  return (
    <div
      className="vf-landing-page"
      style={{
        minHeight: "100vh",
        background:
          "linear-gradient(180deg, #0b1f2a 0%, #132a36 42%, #f6f4ef 42%)",
      }}
      aria-busy="true"
      aria-label="Loading FECSYNC"
    >
      <div
        style={{
          maxWidth: 1120,
          margin: "0 auto",
          padding: "4.5rem 1.25rem 2rem",
        }}
      >
        <div
          style={{
            height: 14,
            width: 120,
            borderRadius: 999,
            background: "rgba(212,175,55,0.45)",
            marginBottom: 18,
          }}
        />
        <div
          style={{
            height: 42,
            width: "min(520px, 92%)",
            borderRadius: 10,
            background: "rgba(255,255,255,0.18)",
            marginBottom: 14,
          }}
        />
        <div
          style={{
            height: 18,
            width: "min(420px, 80%)",
            borderRadius: 8,
            background: "rgba(255,255,255,0.12)",
          }}
        />
      </div>
    </div>
  );
}
