interface SymbolConstructor {
  readonly asyncDispose: unique symbol;
}
interface AsyncDisposable {
  [Symbol.asyncDispose](): PromiseLike<void>;
}
