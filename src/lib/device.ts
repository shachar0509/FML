let id: string | null = null;
/** Set by firstRun (§15.1). Events written before it is known would be unattributable, so getDeviceId throws. */
export const setDeviceId = (v: string): void => void (id = v);
export const getDeviceId = (): string => {
  if (!id) throw new Error("device id not initialised");
  return id;
};
