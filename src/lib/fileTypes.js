// Browsers (notably Chrome on Windows) often report HEIC files with an empty or unknown
// MIME type, so the file extension is checked as well.
const HEIC_EXT = /\.(heic|heif)$/i;

export const isHeicFile = (file) =>
  /^image\/hei[cf]/i.test(file.type) || HEIC_EXT.test(file.name);

export const isImageFile = (file) => file.type.startsWith("image/") || isHeicFile(file);