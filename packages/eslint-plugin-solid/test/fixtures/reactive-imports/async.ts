import { createStore } from "solid-js";

const [state] = createStore({ name: "Ada" });

export async function getStore() {
  return await Promise.resolve(state);
}

export const getSnapshot = async () => await Promise.resolve({ name: state.name });
export const getNested = async () => ({ state: await getStore() });
export const getPending = () => ({ pending: getStore() });
export const getPromise = () => Promise.resolve(state);
export const identity = async (value: unknown) => await Promise.resolve(value);
export const mixed = async (flag: boolean) => (flag ? state : Promise.resolve({ name: "plain" }));

// A lexical Promise binding must not be mistaken for the built-in.
export function shadowed(Promise: { resolve: (value: unknown) => unknown }) {
  return Promise.resolve(state);
}
