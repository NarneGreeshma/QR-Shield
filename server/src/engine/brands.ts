/**
 * Configurable brand intelligence.
 *
 * Legitimate domains are only ever used to *reduce* false positives and to
 * detect impersonation of the brand. We never declare a domain malicious
 * without structural evidence (lookalike tokens, extra subdomains, punycode,
 * etc.).
 */

export interface BrandProfile {
  brand: string;
  /** Official registrable domains — exact matches are always trusted */
  officialDomains: string[];
  /** Keywords that commonly appear in impersonation lures */
  keywords: string[];
}

export const BRANDS: BrandProfile[] = [
  {
    brand: "Google",
    officialDomains: ["google.com", "gmail.com", "google.co.in", "gstatic.com", "googleapis.com", "youtube.com"],
    keywords: ["google", "gmail", "gpay", "googlepay"],
  },
  {
    brand: "Microsoft",
    officialDomains: ["microsoft.com", "live.com", "outlook.com", "office.com", "office365.com", "azure.com", "msn.com"],
    keywords: ["microsoft", "outlook", "office365", "onedrive", "skydrive", "azure"],
  },
  {
    brand: "Apple",
    officialDomains: ["apple.com", "icloud.com", "itunes.com"],
    keywords: ["apple", "icloud", "itunes", "appstore"],
  },
  {
    brand: "Amazon",
    officialDomains: ["amazon.com", "amazon.in", "amzn.to", "amazonpay.com", "ssl-images-amazon.com"],
    keywords: ["amazon", "amazn", "amazonpay"],
  },
  {
    brand: "Meta",
    officialDomains: ["facebook.com", "fb.com", "instagram.com", "meta.com", "whatsapp.com", "messenger.com"],
    keywords: ["facebook", "instagram", "whatsapp", "meta", "fb"],
  },
  {
    brand: "PayPal",
    officialDomains: ["paypal.com", "paypal.in", "paypal.me"],
    keywords: ["paypal", "paypa1", "paypai", "paypal-secure"],
  },
  {
    brand: "PhonePe",
    officialDomains: ["phonepe.com", "phonepe.it.com"],
    keywords: ["phonepe", "phone-pe", "phonep", "phonepe1"],
  },
  {
    brand: "Google Pay",
    officialDomains: ["pay.google.com", "gpay.com"],
    keywords: ["gpay", "googlepay", "google-pay"],
  },
  {
    brand: "SBI",
    officialDomains: ["sbi.co.in", "onlinesbi.com", "sbi.in"],
    keywords: ["sbi", "statebank", "sbi-online", "sbiyono"],
  },
  {
    brand: "HDFC",
    officialDomains: ["hdfcbank.com", "hdfc.com", "hdfcbank.net"],
    keywords: ["hdfc", "hdfcbank", "hdfc-bank"],
  },
  {
    brand: "ICICI",
    officialDomains: ["icicibank.com", "icici.com", "icicibank.in"],
    keywords: ["icici", "icicibank", "ici-bank"],
  },
  {
    brand: "Axis",
    officialDomains: ["axisbank.com", "axisbank.co.in"],
    keywords: ["axis", "axisbank", "axis-bank"],
  },
  {
    brand: "Paytm",
    officialDomains: ["paytm.com", "paytm.in"],
    keywords: ["paytm", "pay-tm", "paytm1"],
  },
  {
    brand: "WhatsApp",
    officialDomains: ["whatsapp.com", "wa.me"],
    keywords: ["whatsapp", "whats-app", "whatsap"],
  },
  {
    brand: "Netflix",
    officialDomains: ["netflix.com", "netflix.in"],
    keywords: ["netflix", "netfIix", "netfl1x"],
  },
  {
    brand: "IRCTC",
    officialDomains: ["irctc.co.in", "irctc.com"],
    keywords: ["irctc", "irctc-login"],
  },
  {
    brand: "UIDAI / Aadhaar",
    officialDomains: ["uidai.gov.in", "myaadhaar.uidai.gov.in"],
    keywords: ["aadhaar", "uidai", "aadhar"],
  },
  {
    brand: "Binance",
    officialDomains: ["binance.com", "binance.org"],
    keywords: ["binance", "binancе"],
  },
];

/** Damerau-free Levenshtein edit distance (bounded for performance). */
export function editDistance(a: string, b: string, max = 4): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** Common homoglyph / typosquat substitutions used in lures. */
const CHAR_SUBSTITUTIONS: Record<string, string> = {
  "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b",
  "@": "a", "$": "s", "!": "i", "|": "i", "-": "", "_": "", ".": "",
};

export function foldChars(value: string): string {
  return value
    .toLowerCase()
    .split("")
    .map((c) => CHAR_SUBSTITUTIONS[c] ?? c)
    .join("");
}

export interface BrandMatch {
  brand: string;
  reason: string;
  /** true when the hostname IS the brand's official domain */
  official: boolean;
  similarity: number;
}

/**
 * Match a hostname against brand intelligence.
 * Returns official matches (trusted) and impersonation indicators.
 */
export function matchBrand(hostname: string): BrandMatch[] {
  const host = hostname.toLowerCase();
  const results: BrandMatch[] = [];
  const labels = host.split(".");
  const registered = labels.length >= 2 ? labels.slice(-2).join(".") : host;

  for (const profile of BRANDS) {
    // 1. Official domain → trusted, and it can never be an impersonator of
    //    another brand (paypal.com must never flag as a Paytm lookalike).
    const official = profile.officialDomains.some(
      (d) => host === d || host.endsWith(`.${d}`),
    );
    if (official) {
      results.push({ brand: profile.brand, reason: `Official domain for ${profile.brand}`, official: true, similarity: 1 });
      return results;
    }

    const foldedHost = foldChars(registered.replace(/\..*$/, "")); // registrable label folded
    const fullFolded = foldChars(registered);

    // Split every hostname label into tokens so brand words inside subdomains
    // (paypal-secure-login.example.com) are caught without matching inside
    // unrelated words (pineapple.example.com).
    const tokens = host
      .split(".")
      .flatMap((label) => label.split(/[-_0-9]+/))
      .filter((t) => t.length >= 3)
      .map(foldChars);

    for (const keyword of profile.keywords) {
      const kw = keyword.toLowerCase();
      // Delimited brand token anywhere in the hostname
      if (tokens.includes(foldChars(kw))) {
        results.push({
          brand: profile.brand,
          reason: `Hostname contains the "${keyword}" token but is not an official ${profile.brand} domain`,
          official: false,
          similarity: 1,
        });
        break;
      }
      // Catch concatenated forms such as "paypalsecure" / "securepaypal" in one label,
      // but only when the brand word is at an edge and the rest is lure vocabulary
      // (so "pineapple" never matches "Apple").
      const LURE_TAIL = /^(secure|login|signin|verify|verification|update|official|support|account|auth|pay|payments|bank|wallet|kyc|in|on|online|id|mail|service|portal|center|centre|page|site|user|users|team|care|help|app|india)$/;
      const labelHit = host.split(".").some((label) => {
        const l = foldChars(label);
        const k = foldChars(kw);
        if (l === k) return true;
        if (l.startsWith(k)) return LURE_TAIL.test(l.slice(k.length));
        if (l.endsWith(k)) return LURE_TAIL.test(l.slice(0, l.length - k.length));
        return false;
      });
      if (labelHit && foldChars(kw).length >= 4) {
        results.push({
          brand: profile.brand,
          reason: `Hostname embeds the "${keyword}" brand name but is not an official ${profile.brand} domain`,
          official: false,
          similarity: 0.9,
        });
        break;
      }
      // Typosquat: registered label within edit distance 2 of the keyword
      const dist = editDistance(foldedHost, foldChars(kw), 2);
      if (dist <= 2 && foldedHost.length >= 4) {
        results.push({
          brand: profile.brand,
          reason: `Registered domain "${registered}" closely resembles ${profile.brand} (edit distance ${dist})`,
          official: false,
          similarity: 1 - dist / Math.max(foldedHost.length, kw.length),
        });
        break;
      }
    }
  }
  return results;
}
