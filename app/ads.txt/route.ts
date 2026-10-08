import { readAdConfig } from "@/lib/ads/policy";

// 📣 /ads.txt — the file ad networks read to confirm who may sell this
// site's ad space. It lists Google only when an AdSense publisher id is
// configured (ADSENSE_CLIENT_ID); otherwise there is no file.
// f08c47fec0942fa0 is Google's own certification-authority id, the same for
// every publisher.
export function GET() {
  const client = readAdConfig(process.env).adsenseClient;
  if (!client) return new Response("Not found", { status: 404 });
  return new Response(
    `google.com, ${client.replace(/^ca-/, "")}, DIRECT, f08c47fec0942fa0\n`,
    { headers: { "Content-Type": "text/plain; charset=utf-8" } }
  );
}
