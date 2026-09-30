/** The content hash the cloud stores by: lowercase hex SHA-256. Works in Node and in a browser. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // A typed array is what digest takes at runtime; the cast only bridges the DOM and Node typings of its parameter.
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
