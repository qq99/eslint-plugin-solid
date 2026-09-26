import { run, tsOnly } from "../ruleTester";
import rule from "../../src/rules/require-match-narrowing";

const settings = { solid: { version: 2 } };
const imports = `import { Match, Switch, Show, For, Repeat, createSignal, createMemo, createStore } from "solid-js";`;
const view = (branch: string, setup = "") => ({
  code: `${imports} function View(props) { ${setup} return <Switch>${branch}</Switch>; }`,
  settings,
  languageOptions: { ecmaVersion: 2022 as const },
});
const invalid = (branch: string, setup = "") => ({
  ...view(branch, setup),
  errors: [{ messageId: "matchNarrowing" }],
});

run("require-match-narrowing regressions", rule, {
  valid: [
    // Independent signals, memos, stores, and properties are distinct sources.
    view(
      `<Match when={ready() === true}><span>{name()}</span></Match>`,
      `const [ready] = createSignal(true); const [name] = createSignal("Ada");`
    ),
    view(
      `<Match when={ready() === true}><span>{name()}</span></Match>`,
      `const ready = createMemo(() => props.ready); const name = createMemo(() => props.name);`
    ),
    view(
      `<Match when={one.ready === true}><span>{two.name}</span></Match>`,
      `const [one] = createStore({ ready: true }); const [two] = createStore({ name: "Ada" });`
    ),
    view(`<Match when={props.ready === true}><span>{props.title}</span></Match>`),
    view(`<Match when={props.detail}><span>{props.title}</span></Match>`),
    view(`<Match when={props.detail?.locked === false}><span>{props.creator.name}</span></Match>`),
    view(
      `<Match when={ready === true}><span>{name}</span></Match>`,
      `const { ready, name } = props;`
    ),
    view(
      `<Match when={props.detail?.locked === false}><span>{props.other.title}</span></Match>`,
      `const detail = props.other;`
    ),
    // Known plain data cannot drift through a reactive read.
    view(`<Match when={title !== ""}><span>{title}</span></Match>`, `const title = "Ada";`),
    view(
      `<Match when={state.ready === true}><span>{state.name}</span></Match>`,
      `const state = { ready: true, name: "Ada" };`
    ),
    // Arithmetic, bitwise operations, typeof and void are not booleans.
    ...["props.count + 1", "props.count & 1", "typeof props.count", "void props.count"].map(
      (when) =>
        view(`<Match when={${when}}>{value => <span>{value()} {props.count}</span>}</Match>`)
    ),
    view(
      `<Match when={Boolean(props.count)}><span>{props.count}</span></Match>`,
      `const Boolean = value => value + 1;`
    ),
    // The actual Peep rewrite: the public branch consumes the narrowed value;
    // the locked branch reads only unrelated basePath data.
    view(
      `<>
      <Match when={props.detail?.locked === false ? props.detail : undefined}>
        {detail => <PublicArtwork basePath={basePath()} detail={detail()} />}
      </Match>
      <Match when={props.detail?.locked === true}>
        <RedeemForm basePath={basePath()} />
      </Match>
    </>`,
      `const basePath = () => props.basePath ?? "";`
    ),
    view(`<Match when={props.detail?.locked === false ? props.detail : undefined} keyed>
      {detail => <PublicArtwork detail={detail} />}
    </Match>`),
    view(`<Match when={props.detail?.locked === false && props.detail}>
      {detail => <PublicArtwork detail={detail()} />}
    </Match>`),
    view(`<Match when={props.detail}>
      {detail => <PublicArtwork detail={detail()} />}
    </Match>`),
    view(`<Match when={props.detail} keyed>
      {detail => <PublicArtwork detail={detail} />}
    </Match>`),
    // Nested guards and deferred callbacks behave identically in both forms.
    ...[
      `<Show when={props.detail}>{detail => <span>{detail().title}</span>}</Show>`,
      `<Show when={props.detail} children={detail => <span>{detail().title}</span>} />`,
    ].flatMap((child) => [
      view(`<Match when={props.detail?.locked === false}>{value => ${child}}</Match>`),
      view(`<Match when={props.detail?.locked === false}>{value => { return ${child}; }}</Match>`),
    ]),
    view(`<Match when={props.detail?.locked === false}>{value => {
      function onClick() { return props.detail?.title; }
      return <button onClick={onClick}>Read later</button>;
    }}</Match>`),
    view(`<Match when={props.detail?.locked === false}>
      <Widget children={() => props.detail?.title} onClick={() => props.detail?.title} />
    </Match>`),
    view(
      `<Match when={ready() === true}><button onClick={ready}>Read later</button></Match>`,
      `const [ready] = createSignal(true);`
    ),
    view(
      `<Match when={props.detail?.locked === false}>{detail => <span>{detail().title}</span>}</Match>`
    ),
    // Type-only references do not read their values at runtime.
    {
      ...view(`<Match when={props.detail?.locked === false}>{value => {
      type Detail = typeof props.detail;
      return <span>Ready</span>;
    }}</Match>`),
      [tsOnly]: true,
    },
  ],
  invalid: [
    // Reduced from Peep's public artwork branch before the hydration fix.
    invalid(`<Match when={props.detail?.locked === false}>
      <img src={props.detail?.assetId} width={props.detail?.displayDimensions?.width} />
      <Show when={props.detail?.tags.length > 0}>
        <For each={props.detail?.tags ?? []}>{tag => <TagBadge tag={tag} />}</For>
      </Show>
      <Show when={props.detail?.comment != null}><p>{props.detail?.comment}</p></Show>
    </Match>`),
    // Returning the selected object alone does not remove an independent read.
    ...[
      `props.detail`,
      `props.detail?.locked === false ? props.detail : undefined`,
      `props.detail?.locked === false ? props.detail : null`,
      `props.detail?.locked !== false ? false : props.detail`,
      `props.detail?.locked === false && props.detail`,
    ].flatMap((when) => [
      invalid(`<Match when={${when}}><span>{props.detail?.title}</span></Match>`),
      invalid(`<Match when={${when}}>{detail => <span>{props.detail?.title}</span>}</Match>`),
    ]),
    invalid(
      `<Match when={detail()}><span>{detail()?.title}</span></Match>`,
      `const [detail] = createSignal(props.initialDetail);`
    ),
    invalid(
      `<Match when={detail}><span>{props.detail?.title}</span></Match>`,
      `const { detail } = props;`
    ),
    invalid(
      `<Match when={detail()?.locked === false}><span>{detail()?.title}</span></Match>`,
      `const [detail] = createSignal(props.initialDetail);`
    ),
    invalid(
      `<Match when={detail()?.locked === false}><span>{alias()?.title}</span></Match>`,
      `const detail = createMemo(() => props.detail); const alias = detail;`
    ),
    invalid(
      `<Match when={detail?.locked === false}><span>{props.detail?.title}</span></Match>`,
      `const { detail } = props;`
    ),
    invalid(
      `<Match when={props.detail?.locked === false}><span>{title}</span></Match>`,
      `const { detail: { title } } = props;`
    ),
    invalid(
      `<Match when={props["detail"]?.["locked"] === false}><span>{props.detail?.title}</span></Match>`
    ),
    invalid(`<Match when={props.detail?.locked === false} children={value => {
      return <span>{props.detail?.title}</span>;
    }} />`),
    ...[
      `<For each={[1]}>{item => <span>{props.detail?.title}</span>}</For>`,
      `<For each={[1]} children={item => <span>{props.detail?.title}</span>} />`,
      `<Repeat count={1}>{item => <span>{props.detail?.title}</span>}</Repeat>`,
    ].map((child) => invalid(`<Match when={props.detail?.locked === false}>${child}</Match>`)),
    {
      ...invalid(`<Match when={(props.detail?.locked === false) as boolean}>
      <span>{(props.detail as { title: string }).title}</span>
    </Match>`),
      [tsOnly]: true,
    },
  ],
});
