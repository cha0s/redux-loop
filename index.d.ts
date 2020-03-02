import { Action, ActionCreator, AnyAction, StoreEnhancer, Store } from 'redux';

export interface StoreCreator {
  <S, A extends Action>(
    reducer: LoopReducer<S, A>,
    preloadedState: S | undefined,
    enhancer: StoreEnhancer<S>
  ): Store<S>;
}

export type Loop<S, A extends Action> = [S, CmdType<A>];

export interface LoopReducer<S, A extends Action = AnyAction> {
  (state: S | undefined, action: A, ...args: any[]): S | Loop<S, A>;
}

export interface LoopReducerWithDefinedState<S, A extends Action = AnyAction> {
  (state: S, action: A, ...args: any[]): S | Loop<S, A>;
}

export interface LiftedLoopReducer<S, A extends Action = AnyAction> {
  (state: S | undefined, action: A, ...args: any[]): Loop<S, A>;
}

export type CmdSimulation = {
  result: any,
  success: boolean
};
export interface MultiCmdSimulation {
  [index: number]: CmdSimulation | MultiCmdSimulation;
}

export interface NoneCmd {
  readonly type: 'NONE';
  simulate(): null;
}

export interface ListCmd<A extends Action> {
  readonly type: 'LIST';
  readonly cmds: CmdType<A>[];
  readonly sequence?: boolean;
  readonly batch?: boolean;
  simulate(simulations: MultiCmdSimulation): A[];
}

export interface ActionCmd<A extends Action> {
  readonly type: 'ACTION';
  readonly actionToDispatch: A;
  simulate(): A;
}

export interface ScheduledCmd<A extends Action> {
  readonly type: 'SCHEDULED';
  readonly nestedCmd: CmdType<A>;
  readonly delayMs: number;
  readonly isRepeating: boolean;
  readonly onScheduledActionCreator?: ActionCreator<A>;
  simulate(simulations?: CmdSimulation | MultiCmdSimulation): A[] | A | null
}

export interface MapCmd<A extends Action> {
  readonly type: 'MAP';
  readonly tagger: ActionCreator<A>;
  readonly nestedCmd: CmdType<A>;
  readonly args: any[];
  simulate(simulations?: CmdSimulation | MultiCmdSimulation): A[] | A | null
}

export interface RunCmd<A extends Action> {
  readonly type: 'RUN';
  readonly func: Function;
  readonly args?: any[];
  readonly failActionCreator?: ActionCreator<A>;
  readonly successActionCreator?: ActionCreator<A>;
  readonly forceSync?: boolean;
  simulate(simulation: CmdSimulation): A
}

//deprecated types
export type SequenceCmd<A extends Action> = ListCmd<A>;
export type BatchCmd<A extends Action> = ListCmd<A>;


export type CmdType<A extends Action> =
  | ActionCmd<A>
  | ScheduledCmd<A>
  | ListCmd<A>
  | MapCmd<A>
  | NoneCmd
  | RunCmd<A>
  | BatchCmd<A>
  | SequenceCmd<A>;

export interface LoopConfig {
  readonly DONT_LOG_ERRORS_ON_HANDLED_FAILURES: boolean;
}

export function install<S>(config?: LoopConfig): StoreEnhancer<S>;

export function loop<S, A extends Action>(
  state: S,
  cmd: CmdType<A>
): Loop<S, A>;

export namespace Cmd {
  export const dispatch: unique symbol;
  export const getState: unique symbol;
  export const none: NoneCmd;
  export function action<A extends Action>(action: A): ActionCmd<A>;
  export function batch<A extends Action>(cmds: CmdType<A>[]): BatchCmd<A>;
  export function sequence<A extends Action>(cmds: CmdType<A>[]): SequenceCmd<A>;

  export function schedule<A extends Action>(
    cmd: CmdType<A>,
    delayMs: number,
    onScheduledActionCreator?: ActionCreator<A>
  ): ScheduledCmd<A>;

  export function scheduleRepeating<A extends Action>(
    cmd: CmdType<A>,
    delayMs: number,
    onScheduledActionCreator?: ActionCreator<A>
  ): ScheduledCmd<A>;

  export function list<A extends Action>(
    cmds: CmdType<A>[],
    options?: {
      batch?: boolean;
      sequence?: boolean;
      testInvariants?: boolean;
    }
  ): ListCmd<A>;

  export function map<A extends Action, B extends Action>(
    cmd: CmdType<B>,
    tagger: (subAction: B) => A,
    args?: any[]
  ): MapCmd<A>;

  export function run<A extends Action, B extends Action>(
    f: Function,
    options?: {
      args?: any[];
      failActionCreator?: ActionCreator<A>;
      successActionCreator?: ActionCreator<B>;
      forceSync?: boolean;
      testInvariants?: boolean;
    }
  ): RunCmd<A>;
}

export type ReducerMapObject<S, A extends Action = AnyAction> = {
  [K in keyof S]: LoopReducer<S[K], A>;
}

export function combineReducers<S, A extends Action = AnyAction>(
  reducers: ReducerMapObject<S, A>
): LiftedLoopReducer<S, A>;

export function mergeChildReducers<S, A extends Action = AnyAction>(
  parentResult: S | Loop<S, A>,
  action: AnyAction,
  childMap: ReducerMapObject<S, A>
): Loop<S, A>;

export function reduceReducers<S, A extends Action = AnyAction>(
  initialReducer: LoopReducer<S, A>,
  ...reducers: Array<LoopReducerWithDefinedState<S, A>>
): LiftedLoopReducer<S, A>;

export function liftState<S, A extends Action>(
  state: S | Loop<S, A>
): Loop<S, A>;

export function isLoop(test: any): boolean;

export function getModel<S>(loop: S | Loop<S, AnyAction>): S;

export function getCmd<A extends Action>(a: any): CmdType<A> | null;
