// 4) taxiavm-driver/src/lib/plateKey.ts
export function plateKeyOf(plate: string) {
  return plate.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function driverEmailFromPlateKey(plateKey: string) {
  // internal “pseudo-email”; drivers type plate+password but app uses this
  return `${plateKey}@drivers.local`;
}
