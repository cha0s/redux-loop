import {
  reduceReducers,
  Loop,
  LoopReducer,
  LoopReducerWithDefinedState,
  getModel,
  getCmd,
  CmdType
} from '../../index';
import { AnyAction } from 'redux';

type ReducedState = { add: number; mult: number };

const initialState: ReducedState = {
  add: 0,
  mult: 2
};

type ReducedActions =
  | {
      type: 'change';
      value: number;
    };

const addReducer: LoopReducer<ReducedState, ReducedActions> = (
  state = initialState,
  action: AnyAction
) => {
  if(action.type === 'change'){
    return {...state, add: state.add + action.value};
  }
  return state;
};

const multReducer: LoopReducerWithDefinedState<ReducedState, ReducedActions> = (
  state,
  action: AnyAction
) => {
  if(action.type === 'change'){
    return {...state, mult: state.mult * action.value};
  }
  return state;
};

const change = (value: number): ReducedActions => ({
  type: 'change',
  value
});

const reducer = reduceReducers(addReducer, multReducer);

const result: Loop<ReducedState, ReducedActions> = reducer(undefined, change(5));
const newState: ReducedState = getModel(result);
const cmd: CmdType<ReducedActions> | null = getCmd(result);
