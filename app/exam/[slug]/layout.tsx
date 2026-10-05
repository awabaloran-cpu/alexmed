import "@/app/globals.css";

export default function PublicExamLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <main className="min-h-screen bg-background text-foreground">{children}</main>;
}
