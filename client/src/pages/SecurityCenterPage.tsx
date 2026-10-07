import {
  Fingerprint, Link2, Globe, Shuffle, CreditCard, EyeOff, MessageSquareWarning, Satellite,
} from "lucide-react";
import { Badge, Panel } from "@/components/ui";

const CATEGORIES = [
  {
    id: "identity",
    title: "Identity",
    icon: Fingerprint,
    color: "text-cyan-300",
    checks: [
      "Brand impersonation across 18 configured brands (Google, PayPal, PhonePe, SBI, HDFC…)",
      "Homograph & mixed-script characters (Cyrillic/Greek lookalikes)",
      "Typosquat and edit-distance similarity to trusted domains",
      "Official-domain verification to prevent false accusations",
    ],
  },
  {
    id: "url",
    title: "URL",
    icon: Link2,
    color: "text-emerald-300",
    checks: [
      "HTTPS vs HTTP scheme validation",
      "Bare IP address destinations",
      "Non-standard and abuse-associated ports",
      "URL shorteners that hide the real destination",
      "Embedded credentials ('@' trick)",
      "Redirect-style and payload query parameters",
      "Executable download file extensions",
    ],
  },
  {
    id: "domain",
    title: "Domain",
    icon: Globe,
    color: "text-amber-300",
    checks: [
      "Excessive and deceptive subdomain chains",
      "High-abuse TLDs (.tk, .zip, .top…)",
      "Lookalike registered-domain construction",
      "Free-hosting and dynamic-DNS infrastructure",
    ],
  },
  {
    id: "redirects",
    title: "Redirects",
    icon: Shuffle,
    color: "text-violet-300",
    checks: [
      "Chained URLs across multiple hosts",
      "Open-redirect parameters (next, url, dest, return…)",
    ],
  },
  {
    id: "payments",
    title: "Payments",
    icon: CreditCard,
    color: "text-rose-300",
    checks: [
      "UPI payload parsing: payee, amount, merchant code, notes",
      "Free-email payees and unusual merchant identifiers",
      "Unusually high requested amounts",
      "Cryptocurrency payment payloads (irreversible transfers)",
      "Always: 'verify the recipient' — never an unverified fraud claim",
    ],
  },
  {
    id: "obfuscation",
    title: "Obfuscation",
    icon: EyeOff,
    color: "text-fuchsia-300",
    checks: [
      "Heavy percent-encoding and nested URL encoding",
      "Base64 blobs hiding destinations",
      "Punycode (xn--) internationalized domains",
      "Overlong payloads designed to bury the real host",
    ],
  },
  {
    id: "social_engineering",
    title: "Social engineering",
    icon: MessageSquareWarning,
    color: "text-orange-300",
    checks: [
      "Login / verification bait keywords",
      "Urgency and threat language ('suspended', '24 hours', 'prize')",
      "Smishing patterns in SMS payloads",
      "Weak or open WiFi credential shares",
    ],
  },
  {
    id: "threat_intel",
    title: "Threat intelligence",
    icon: Satellite,
    color: "text-sky-300",
    checks: [
      "Bundled known-bad indicator matching (evidence-based, no claims without a hit)",
      "Suspicious infrastructure (dynamic DNS, public tunnels, free phishing-prone hosting)",
      "Domain-reputation heuristics — labeled as signals, not proof",
    ],
  },
];

export function SecurityCenterPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">What QR Shield checks</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          Every scan runs through the full detector matrix. Detectors that don&apos;t apply to a payload type
          still execute and return clean — so the analyst view always shows the complete picture.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {CATEGORIES.map(({ id, title, icon: Icon, color, checks }) => (
          <Panel key={id} className="panel-hover">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5">
                <Icon className={`h-5 w-5 ${color}`} aria-hidden />
              </div>
              <h3 className="text-base font-semibold text-white">{title}</h3>
              <Badge className="ml-auto">{id}</Badge>
            </div>
            <ul className="mt-4 space-y-2">
              {checks.map((c) => (
                <li key={c} className="flex gap-2 text-sm text-slate-400">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                  {c}
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>

      <Panel>
        <h3 className="text-base font-semibold text-white">Scoring model</h3>
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "LOW", range: "+8 points", tone: "safe" as const },
            { label: "MEDIUM", range: "+16 points", tone: "warn" as const },
            { label: "HIGH", range: "+28 points", tone: "danger" as const },
            { label: "CRITICAL", range: "+40 points", tone: "danger" as const },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border border-white/5 bg-base-900/60 p-3">
              <Badge tone={s.tone}>{s.label}</Badge>
              <p className="mt-2 font-mono text-lg font-bold text-slate-100">{s.range}</p>
              <p className="text-xs text-slate-500">per detector, capped at 40</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-sm text-slate-400">
          0–29 SAFE · 30–64 SUSPICIOUS · 65–100 DANGEROUS. Contributions are summed, capped at 100,
          and identical contributions are de-duplicated — the same payload always produces the same score.
          LOW = +8 · MEDIUM = +16 · HIGH = +28 · CRITICAL = +40 (within the +5…+40 bands).
        </p>
      </Panel>
    </div>
  );
}
