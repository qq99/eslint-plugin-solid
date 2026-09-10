export interface ReaderChunk {
  user_translation: string | null;
  author: { name: string };
}

export type Callback = (scope: string) => void;
export type Props<T> = { value: T; onChange?: Callback };
export type Recursive = Recursive;
