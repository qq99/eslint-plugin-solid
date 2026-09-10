import { createStore } from "solid-js";

const [state] = createStore({ name: "Ada" });

export async function* proxyStream() {
  yield state;
}
export async function* snapshotStream() {
  yield { name: state.name };
}
export async function* finalReturnStream() {
  yield { name: "plain" };
  return state;
}
export function* syncStream() {
  yield state;
}
export async function* delegatedStream() {
  yield* syncStream();
}
export async function* arrayStream() {
  yield* [state];
}
export async function* promiseStream() {
  yield Promise.resolve(state);
}
export async function* identityStream(value: unknown) {
  yield value;
}
async function* returnsStore() {
  return state;
}
export async function* delegatedReturn() {
  const value = yield* returnsStore();
  yield value;
}
function* returnsPromise() {
  return Promise.resolve(state);
}
export async function* delegatedPromiseReturn() {
  const value = yield* returnsPromise();
  yield { value };
}
