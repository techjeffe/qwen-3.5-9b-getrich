export default function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
    return (
        <div className={`rounded-2xl p-5 ${className}`}
            style={{ background: "rgba(30,41,59,0.75)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.07)" }}>
            {children}
        </div>
    );
}