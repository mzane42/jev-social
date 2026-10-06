globalThis.fetch = () => {
  throw new Error("Network access forbidden in offline test context.");
};
