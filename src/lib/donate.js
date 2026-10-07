// Donation logic only: no UI here. Used by DonateCard and DonateQR.
//
// Env (set in .env.local AND the host dashboard, then rebuild):
//   NEXT_PUBLIC_UPI_ID    e.g. yourname@bank
//   NEXT_PUBLIC_UPI_NAME  name shown in the payment app
//   NEXT_PUBLIC_BMAC_URL  e.g. https://buymeacoffee.com/yourname
// NEXT_PUBLIC_ values are public by design (anyone scanning the QR sees the UPI ID).

export const PRESET_AMOUNTS = [10, 20, 50, 100, 200, 500];
export const DEFAULT_AMOUNT = 50;
export const MIN_AMOUNT = 1;
export const MAX_AMOUNT = 100000;
export const UPI_NOTE = "PixShrink tip";

// A UPI ID looks like name@bank: letters, digits, dot, dash, underscore, then @handle.
const UPI_ID_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.]{1,63}$/;

/* --------------------------------- config --------------------------------- */

export function getDonateConfig() {
  // Each NEXT_PUBLIC_ variable must be written out in full for Next.js to inline it.
  const upiId = (process.env.NEXT_PUBLIC_UPI_ID || "").trim();
  const upiName = (process.env.NEXT_PUBLIC_UPI_NAME || "").trim();
  const bmacRaw = (process.env.NEXT_PUBLIC_BMAC_URL || "").trim();

  const upiReady = UPI_ID_RE.test(upiId) && upiName.length > 0;

  let bmacUrl = "";
  try {
    const u = new URL(bmacRaw);
    if (u.protocol === "https:") bmacUrl = u.toString();
  } catch {
    // missing or invalid: the Buy Me a Coffee button stays hidden
  }
  const bmacReady = bmacUrl !== "";

  return {
    upiId,
    upiName,
    upiReady,
    bmacUrl,
    bmacReady,
    enabled: upiReady || bmacReady,
  };
}

/* --------------------------------- amounts --------------------------------- */

// Keeps only digits and one dot, with at most 2 decimals. Safe to run on every keystroke.
export function cleanAmountInput(raw) {
  const text = String(raw ?? "").replace(/[^\d.]/g, "");
  const dot = text.indexOf(".");
  if (dot === -1) return text.slice(0, 7);
  const whole = text.slice(0, dot).slice(0, 7);
  const frac = text.slice(dot + 1).replace(/\./g, "").slice(0, 2);
  return `${whole}.${frac}`;
}

// Returns { ok: true, amount } or { ok: false, error }.
export function validateAmount(text) {
  const t = String(text ?? "").trim();
  if (t === "") return { ok: false, error: "Enter an amount." };
  if (!/^\d+(\.\d{1,2})?$/.test(t)) {
    return { ok: false, error: "Use numbers only, up to 2 decimals." };
  }
  const amount = Math.round(Number(t) * 100) / 100;
  if (amount < MIN_AMOUNT) {
    return { ok: false, error: `The smallest amount is Rs ${MIN_AMOUNT}.` };
  }
  if (amount > MAX_AMOUNT) {
    return {
      ok: false,
      error: `The largest amount is ${formatRupees(MAX_AMOUNT)}.`,
    };
  }
  return { ok: true, amount };
}

export function formatRupees(amount) {
  const n = Number(amount) || 0;
  const whole = Number.isInteger(n);
  return `Rs ${n.toLocaleString("en-IN", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

// How happy the cat is: 0 small smile ... 3 happy closed eyes.
// Rs 10 -> 0, 20 and 50 -> 1, 100 and 200 -> 2, 500 and up -> 3.
export function moodForAmount(amount) {
  const n = Number(amount) || 0;
  if (n >= 500) return 3;
  if (n >= 100) return 2;
  if (n >= 20) return 1;
  return 0;
}

/* -------------------------------- UPI link -------------------------------- */

export function buildUpiLink(config, amount) {
  if (!config?.upiReady) throw new Error("UPI is not set up.");
  const res = validateAmount(String(amount));
  if (!res.ok) throw new Error(res.error);

  const am = Number.isInteger(res.amount)
    ? String(res.amount)
    : res.amount.toFixed(2);

  // encodeURIComponent turns "@" into %40, which some apps dislike, so put it back.
  const pa = encodeURIComponent(config.upiId).replace(/%40/g, "@");
  const params = [
    `pa=${pa}`,
    `pn=${encodeURIComponent(config.upiName)}`,
    `am=${am}`,
    "cu=INR",
    `tn=${encodeURIComponent(UPI_NOTE)}`,
  ];
  return `upi://pay?${params.join("&")}`;
}

/* ---------------------------------- QR ---------------------------------- */

// Loaded only when first needed, so the qrcode library is not in the main bundle.
// Error correction level H leaves room for the center logo.
export async function generateQrMatrix(value) {
  const mod = await import("qrcode");
  const QRCode = mod.default ?? mod;
  const qr = QRCode.create(String(value), { errorCorrectionLevel: "H" });
  const size = qr.modules.size;
  const modules = [];
  for (let r = 0; r < size; r++) {
    const row = new Array(size);
    for (let c = 0; c < size; c++) row[c] = Boolean(qr.modules.get(r, c));
    modules.push(row);
  }
  return { size, modules };
}

// True for the three 7x7 finder squares (top-left, top-right, bottom-left).
export function isFinderModule(r, c, n) {
  return (
    (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7)
  );
}