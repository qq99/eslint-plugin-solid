import { useQuery as query } from "@tanstack/solid-query";
import * as Solid from "solid-js";

export function getQuery(options: unknown) {
  return query(options);
}

export default getQuery;

export function getStore(initial = { count: 0 }) {
  const [state] = Solid.createStore(initial);
  return state;
}

export function getAccessor() {
  const [read] = Solid.createSignal(0);
  return read;
}

export const getSignal = () => Solid.createSignal(0);
export const store = Solid.createStore({ theme: "light" })[0];
export const getContainer = () => ({ store });

export function createOptions() {
  return { theme: "light" };
}

export function getSnapshot() {
  const [state] = Solid.createStore({ theme: "light" });
  return { theme: state.theme };
}

export function shadowed(query: () => unknown) {
  return query();
}

export const circularA = circularB;
export const circularB = circularA;
