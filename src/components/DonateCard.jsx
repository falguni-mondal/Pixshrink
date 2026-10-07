"use client";

// Donation card: cat scene, honest short note, amount chips, custom amount, Pay with UPI
// and Buy Me a Coffee. On desktop the UPI QR replaces the cat scene (with a Back button).
// On phones the UPI button opens the UPI app directly and the QR is a secondary option.
//
// Hovering an amount chip (mouse) previews the cat's smile for that amount. Leaving the
// chip returns the cat to the smile of the currently selected or typed amount.
//
// Needs (set in .env.local and the host dashboard):
//   NEXT_PUBLIC_UPI_ID, NEXT_PUBLIC_UPI_NAME, NEXT_PUBLIC_BMAC_URL
// A missing option is hidden. If both are missing the card renders nothing.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DonateCat from "@/components/DonateCat";
import DonateQR from "@/components/DonateQR";
import { isMobileDevice, prefersReducedMotion } from "@/lib/device";
import {
  DEFAULT_AMOUNT,
  PRESET_AMOUNTS,
  buildUpiLink,
  cleanAmountInput,
  formatRupees,
  getDonateConfig,
  moodForAmount,
  validateAmount,
} from "@/lib/donate";

const SIGN_MS = 800; // how long the cat holds the sign before the QR takes over

const btnBase =
  "cursor-pointer rounded-none border-[3px] border-neutral-900 text-xs font-black uppercase tracking-wider text-neutral-900 transition-transform focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-neutral-900/30 active:translate-x-0 active:translate-y-0 active:shadow-none";

// Amount chips. The text color lives here and nowhere else: the old selected state added a
// second text color class on top of btnBase's, and the two fought (dark text on a dark fill).
const chipBase =
  "flex h-10 cursor-pointer items-center justify-center rounded-none border-[3px] border-neutral-900 px-2 text-xs font-black uppercase tracking-wider text-neutral-900 transition-[transform,box-shadow,background-color] duration-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-neutral-900/30";

export default function DonateCard({ className = "" }) {
  const config = useMemo(() => getDonateConfig(), []);
  const { upiReady, bmacReady, bmacUrl, enabled } = config;

  const [selected, setSelected] = useState(DEFAULT_AMOUNT);
  const [custom, setCustom] = useState("");
  const [error, setError] = useState("");
  const [qrLink, setQrLink] = useState(""); // set while the QR is showing
  const [holdSign, setHoldSign] = useState(false);
  const [thanks, setThanks] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [hoverAmount, setHoverAmount] = useState(null); // chip under the mouse, if any

  const cardRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    setMobile(isMobileDevice());
    return () => clearTimeout(timerRef.current);
  }, []);

  const amountText = custom !== "" ? custom : String(selected);
  const checked = validateAmount(amountText);
  const baseMood = checked.ok ? moodForAmount(checked.amount) : 0;
  // While a chip is hovered, the cat smiles for that chip's amount.
  const mood = hoverAmount !== null ? moodForAmount(hoverAmount) : baseMood;

  const pickChip = (a) => {
    setSelected(a);
    setCustom("");
    setError("");
    setHoverAmount(null);
  };

  const onCustom = (e) => {
    setCustom(cleanAmountInput(e.target.value));
    setError("");
  };

  const onChipEnter = (e, a) => {
    if (e.pointerType !== "mouse") return; // touch has no hover
    setHoverAmount(a);
  };

  const onChipLeave = () => setHoverAmount(null);

  const makeLink = useCallback(() => {
    const res = validateAmount(amountText);
    if (!res.ok) {
      setError(res.error);
      return null;
    }
    try {
      return buildUpiLink(config, res.amount);
    } catch (err) {
      setError(err.message);
      return null;
    }
  }, [amountText, config]);

  const payUpi = () => {
    const link = makeLink();
    if (!link) return;
    setThanks(true);
    setHoverAmount(null);
    if (mobile) {
      window.location.href = link; // opens GPay, PhonePe, Paytm...
      return;
    }
    // Desktop: the cat holds up the sign, then the QR takes its place.
    setHoldSign(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(
      () => setQrLink(link),
      prefersReducedMotion() ? 0 : SIGN_MS,
    );
  };

  const showQr = () => {
    const link = makeLink();
    if (!link) return;
    setThanks(true);
    setHoverAmount(null);
    setQrLink(link);
  };

  const closeQr = () => {
    clearTimeout(timerRef.current);
    setQrLink("");
    setHoldSign(false);
    setHoverAmount(null);
  };

  const openBmac = useCallback(() => {
    window.open(bmacUrl, "_blank", "noopener,noreferrer");
    setThanks(true);
  }, [bmacUrl]);

  if (!enabled) return null;

  return (
    <div
      ref={cardRef}
      className={`w-full rounded-none border-[3px] border-neutral-900 bg-white p-5 text-left shadow-[6px_6px_0_rgba(17,17,17,1)] ${className}`}
    >
      {/* scene: cat, or the QR while paying (desktop) */}
      {qrLink ? (
        <div className="flex flex-col items-center gap-4">
          <DonateQR
            value={qrLink}
            label={`UPI payment QR code for ${config.upiId}, amount ${formatRupees(checked.ok ? checked.amount : 0)}`}
          />
          <p className="text-center text-xs font-bold uppercase tracking-wide text-neutral-900">
            Scan with any UPI app
            <span className="mt-1 block font-mono text-[11px] text-neutral-500">
              {config.upiId} · {checked.ok ? formatRupees(checked.amount) : ""}
            </span>
          </p>
          <button
            type="button"
            onClick={closeQr}
            className={`${btnBase} bg-white px-4 py-2 shadow-[3px_3px_0_rgba(17,17,17,1)]`}
          >
            Back
          </button>
        </div>
      ) : (
        <>
          <div className="relative z-10 mx-auto w-full max-w-[280px]">
            <DonateCat
              mood={mood}
              holdSign={holdSign}
              watchRef={cardRef}
              onCupClick={bmacReady ? openBmac : undefined}
            />
          </div>

          <h3 className="mt-3 text-lg font-black uppercase leading-tight tracking-tight text-neutral-900">
            Like PixShrink? Feed the cat.
          </h3>
          <p className="mt-2 text-sm font-medium leading-relaxed text-neutral-600">
            PixShrink is{" "}
            <span className="bg-[var(--accent)] px-1 font-black uppercase tracking-wide text-neutral-900">
              100% free
            </span>
            , with no ads and no uploads. I&apos;m a one-person builder from a
            lower-middle-class family, and your tips are what let me keep making
            tools that stay free for everyone.
          </p>

          {/* amounts */}
          <div
            role="group"
            aria-label="Choose an amount in rupees"
            className="relative z-0 mt-5 grid grid-cols-3 gap-3"
          >
            {PRESET_AMOUNTS.map((a) => {
              const active = custom === "" && selected === a;
              return (
                <button
                  key={a}
                  type="button"
                  aria-pressed={active}
                  onClick={() => pickChip(a)}
                  onPointerEnter={(e) => onChipEnter(e, a)}
                  onPointerLeave={onChipLeave}
                  className={`${chipBase} ${
                    active
                      ? // Selected: accent fill, black text, pressed into the page (shadow gone).
                        "translate-x-[3px] translate-y-[3px] bg-[var(--accent)] shadow-none"
                      : "bg-white shadow-[3px_3px_0_rgba(17,17,17,1)] hover:-translate-y-0.5 hover:translate-x-0.5 hover:bg-neutral-100 active:translate-x-[3px] active:translate-y-[3px] active:shadow-none"
                  }`}
                >
                  Rs {a}
                </button>
              );
            })}
          </div>

          <label className="mt-4 flex items-center gap-3 text-xs font-black uppercase tracking-wider text-neutral-900">
            Custom
            <span className="flex h-10 flex-1 items-center border-[3px] border-neutral-900 bg-white pl-3 shadow-[2px_2px_0_rgba(17,17,17,1)] focus-within:border-[var(--accent)]">
              <span className="font-mono text-xs font-bold text-neutral-400">Rs</span>
              <input
                type="text"
                inputMode="decimal"
                placeholder={String(selected)}
                value={custom}
                onChange={onCustom}
                aria-invalid={Boolean(error)}
                className="h-full min-w-0 flex-1 bg-transparent px-2 font-mono text-sm font-bold text-neutral-900 outline-none placeholder:font-normal placeholder:text-neutral-400"
              />
            </span>
          </label>

          {error && (
            <p role="alert" className="mt-2 text-xs font-bold text-red-600">
              {error}
            </p>
          )}

          {/* buttons */}
          <div className="mt-5 flex flex-col gap-3">
            {upiReady && (
              <button
                type="button"
                onClick={payUpi}
                className={`${btnBase} flex h-12 items-center justify-center bg-[var(--accent)] px-4 shadow-[4px_4px_0_rgba(17,17,17,1)] hover:-translate-y-0.5 hover:translate-x-0.5 hover:shadow-[6px_6px_0_rgba(17,17,17,1)]`}
              >
                Pay {checked.ok ? formatRupees(checked.amount) : ""} with UPI
              </button>
            )}
            {upiReady && mobile && (
              <button
                type="button"
                onClick={showQr}
                className="cursor-pointer self-start text-[11px] font-bold uppercase tracking-wider text-neutral-500 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-neutral-900/30"
              >
                Show QR instead
              </button>
            )}
            {bmacReady && (
              <button
                type="button"
                onClick={openBmac}
                className={`${btnBase} flex h-10 items-center justify-center bg-white px-4 shadow-[3px_3px_0_rgba(17,17,17,1)] hover:-translate-y-0.5 hover:translate-x-0.5`}
              >
                Buy me a coffee (international)
              </button>
            )}
          </div>
        </>
      )}

      {thanks && (
        <p
          role="status"
          aria-live="polite"
          className="mt-4 border-t-2 border-neutral-100 pt-3 text-xs font-bold text-neutral-700"
        >
          Thank you. Whether you tip or not, I&apos;m glad PixShrink helped.
        </p>
      )}
    </div>
  );
}