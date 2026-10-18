import { monotonicFactory } from "ulid";

// monotonic: ids created in the same millisecond still sort in creation order ((ts,id) merge, 3.6/3.8)
const ulid = monotonicFactory();

export const newId = (): string => ulid();
export const stageId = (n: number): string => `S${String(n).padStart(3, "0")}`;
export const unitId = (n: number): string => `U${String(n).padStart(2, "0")}`;
