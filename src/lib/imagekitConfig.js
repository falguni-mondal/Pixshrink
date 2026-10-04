// Server-only helper. The ImageKit engine exists only when ALL of these are true:
//   NEXT_IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY and NEXT_IMAGEKIT_URL_ENDPOINT are set,
//   and ENVIRONMENT_MODE is "development".
// None of these names start with NEXT_PUBLIC_, so they are never sent to the browser.
export function isImageKitEnabled() {
  const env = process.env;
  return Boolean(
    env.NEXT_IMAGEKIT_PUBLIC_KEY &&
      env.IMAGEKIT_PRIVATE_KEY &&
      env.NEXT_IMAGEKIT_URL_ENDPOINT &&
      env.ENVIRONMENT_MODE?.trim().toLowerCase() === "development"
  );
}