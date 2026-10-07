import { ScanWorkspace } from "@/components/ScanWorkspace";

export function ScanPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Scan &amp; analyze</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          Decode a real QR code and run it through the QR Shield security engine. Every score is
          computed on the server from structured detector evidence — nothing is faked in the browser.
        </p>
      </div>
      <ScanWorkspace />
    </div>
  );
}
