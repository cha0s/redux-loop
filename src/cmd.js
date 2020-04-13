import { throwInvariant, flatten, isPromiseLike } from './utils';

const isCmdSymbol = Symbol('isCmd');
const dispatchSymbol = Symbol('dispatch');
const getStateSymbol = Symbol('getState');

const cmdTypes = {
  RUN: 'RUN',
  ACTION: 'ACTION',
  DELAY: 'DELAY',
  LIST: 'LIST',
  MAP: 'MAP',
  NONE: 'NONE'
};

export function isCmd(object) {
  return object ? !!object[isCmdSymbol] : false;
}

function getMappedCmdArgs(args = [], dispatch, getState) {
  return args.map(arg => {
    if (arg === dispatchSymbol) {
      return dispatch;
    } else if (arg === getStateSymbol) {
      return getState;
    } else {
      return arg;
    }
  });
}

function handleRunCmd(cmd, dispatch, getState, loopConfig = {}) {
  let onSuccess = cmd.successActionCreator || (() => {});

  let onFail;
  if (cmd.failActionCreator) {
    onFail = error => {
      if (!loopConfig.DONT_LOG_ERRORS_ON_HANDLED_FAILURES) {
        console.error(error);
      }
      return cmd.failActionCreator(error);
    };
  } else {
    onFail = console.error;
  }

  try {
    let result = cmd.func(...getMappedCmdArgs(cmd.args, dispatch, getState));

    if (isPromiseLike(result) && !cmd.forceSync) {
      return result.then(onSuccess, onFail).then(action => {
        return action ? [action] : [];
      });
    }
    let resultAction = onSuccess(result);
    return resultAction ? Promise.resolve([resultAction]) : null;
  } catch (err) {
    if (!cmd.failActionCreator) {
      console.error(err);
      throw err; //don't swallow errors if they are not handling them
    }
    let resultAction = onFail(err);
    return resultAction ? Promise.resolve([resultAction]) : null;
  }
}

function handleParallelList(
  { cmds, batch = false },
  dispatch,
  getState,
  loopConfig = {}
) {
  const promises = cmds
    .map(nestedCmd => {
      const possiblePromise = executeCmd(
        nestedCmd,
        dispatch,
        getState,
        loopConfig
      );
      if (!possiblePromise || batch) {
        return possiblePromise;
      }

      return possiblePromise.then(result => {
        return Promise.all(result.map(a => dispatch(a)));
      });
    })
    .filter(x => x);

  if (promises.length === 0) {
    return null;
  }

  return Promise.all(promises)
    .then(flatten)
    .then(actions => {
      return batch ? actions : [];
    });
}

function handleSequenceList(
  { cmds, batch = false },
  dispatch,
  getState,
  loopConfig = {}
) {
  const firstCmd = cmds.length ? cmds[0] : null;
  if (!firstCmd) {
    return null;
  }

  const result = new Promise(resolve => {
    let firstPromise = executeCmd(firstCmd, dispatch, getState, loopConfig);
    firstPromise = firstPromise || Promise.resolve([]);
    firstPromise.then(result => {
      let executePromise;
      if (!batch) {
        executePromise = Promise.all(result.map(a => dispatch(a)));
      } else {
        executePromise = Promise.resolve();
      }
      executePromise.then(() => {
        const remainingSequence = list(cmds.slice(1), {
          batch,
          sequence: true
        });
        const remainingPromise = executeCmd(
          remainingSequence,
          dispatch,
          getState,
          loopConfig
        );
        if (remainingPromise) {
          remainingPromise.then(innerResult => {
            resolve(result.concat(innerResult));
          });
        } else {
          resolve(result);
        }
      });
    });
  }).then(flatten);

  return batch ? result : result.then(() => []);
}

function handleDelayCmd(cmd, dispatch, getState, loopConfig) {
  const setIntervalOrTimeout = cmd.isRepeating ? setInterval : setTimeout;
  const handle = setIntervalOrTimeout(() => {
    const cmdPromise = executeCmd(
      cmd.nestedCmd,
      dispatch,
      getState,
      loopConfig
    );
    if (cmdPromise) {
      cmdPromise.then(actions => {
        actions.forEach(action => dispatch(action));
      });
    }
  }, cmd.delayMs);

  if (cmd.scheduledActionCreator) {
    return Promise.resolve([cmd.scheduledActionCreator(handle)]);
  } else {
    return null;
  }
}

export function executeCmd(cmd, dispatch, getState, loopConfig = {}) {
  switch (cmd.type) {
    case cmdTypes.RUN:
      return handleRunCmd(cmd, dispatch, getState, loopConfig);

    case cmdTypes.ACTION:
      return Promise.resolve([cmd.actionToDispatch]);

    case cmdTypes.DELAY:
      return handleDelayCmd(cmd, dispatch, getState, loopConfig);

    case cmdTypes.LIST:
      return cmd.sequence
        ? handleSequenceList(cmd, dispatch, getState, loopConfig)
        : handleParallelList(cmd, dispatch, getState, loopConfig);

    case cmdTypes.MAP: {
      const possiblePromise = executeCmd(
        cmd.nestedCmd,
        dispatch,
        getState,
        loopConfig
      );
      if (!possiblePromise) {
        return null;
      }
      return possiblePromise.then(actions =>
        actions.map(action => cmd.tagger(...cmd.args, action))
      );
    }

    case cmdTypes.NONE:
      return null;

    default:
      throw new Error(`Invalid Cmd type ${cmd.type}`);
  }
}

function simulateRun({ result, success }) {
  if (success && this.successActionCreator) {
    return this.successActionCreator(result);
  } else if (!success && this.failActionCreator) {
    return this.failActionCreator(result);
  }
  return null;
}

function run(func, options = {}) {
  if (process.env.NODE_ENV !== 'production') {
    if (!options.testInvariants) {
      throwInvariant(
        typeof func === 'function',
        'Cmd.run: first argument to Cmd.run must be a function'
      );

      throwInvariant(
        typeof options === 'object',
        'Cmd.run: second argument to Cmd.run must be an options object'
      );

      throwInvariant(
        !options.successActionCreator ||
          typeof options.successActionCreator === 'function',
        'Cmd.run: successActionCreator option must be a function if specified'
      );

      throwInvariant(
        !options.failActionCreator ||
          typeof options.failActionCreator === 'function',
        'Cmd.run: failActionCreator option must be a function if specified'
      );

      throwInvariant(
        !options.args || options.args.constructor === Array,
        'Cmd.run: args option must be an array if specified'
      );
    }
  } else if (options.testInvariants) {
    throw Error(
      "Redux Loop: Detected usage of Cmd.run's testInvariants option in production code. This should only be used in tests."
    );
  }

  const { testInvariants, ...rest } = options;

  return Object.freeze({
    [isCmdSymbol]: true,
    type: cmdTypes.RUN,
    func,
    simulate: simulateRun,
    ...rest
  });
}

function simulateAction() {
  return this.actionToDispatch;
}

function action(actionToDispatch) {
  if (process.env.NODE_ENV !== 'production') {
    throwInvariant(
      typeof actionToDispatch === 'object' &&
        actionToDispatch !== null &&
        typeof actionToDispatch.type !== 'undefined',
      'Cmd.action: first argument and only argument to Cmd.action must be an action'
    );
  }

  return Object.freeze({
    [isCmdSymbol]: true,
    type: cmdTypes.ACTION,
    actionToDispatch,
    simulate: simulateAction
  });
}

function clearTimeoutCmd(timerId) {
  return Cmd.run(clearTimeout, { args: [timerId] });
}

function clearIntervalCmd(timerId) {
  return Cmd.run(clearInterval, { args: [timerId] });
}

function setTimeoutCmd(nestedCmd, delayMs, options = {}) {
  return delay(nestedCmd, delayMs, options, false);
}

function setIntervalCmd(nestedCmd, delayMs, options = {}) {
  return delay(nestedCmd, delayMs, options, true);
}

function delay(nestedCmd, delayMs, options, isRepeating) {
  if (process.env.NODE_ENV !== 'production') {
    const name = isRepeating ? 'Cmd.setInterval' : 'Cmd.setTimeout';
    throwInvariant(
      isCmd(nestedCmd),
      `${name}: first argument must be another Cmd`
    );
    throwInvariant(
      typeof delayMs === 'number',
      `${name}: second argument must be a number`
    );
    throwInvariant(
      typeof options === 'object',
      `${name}: third argument must be an options object`
    );
    throwInvariant(
      options.scheduledActionCreator === undefined ||
        typeof options.scheduledActionCreator === 'function',
      `${name}: scheduledActionCreator option must be a function if specified`
    );
  }

  return Object.freeze({
    [isCmdSymbol]: true,
    type: cmdTypes.DELAY,
    nestedCmd,
    delayMs,
    isRepeating,
    scheduledActionCreator: options.scheduledActionCreator,
    simulate: simulateDelay
  });
}

function simulateDelay(timerId, nestedSimulation) {
  let result = this.nestedCmd.simulate(nestedSimulation);
  let nestedActions = null;
  if (Array.isArray(result)) {
    nestedActions = result;
  } else if (result) {
    nestedActions = [result];
  }

  if (this.scheduledActionCreator) {
    return [this.scheduledActionCreator(timerId)].concat(nestedActions);
  } else {
    return nestedActions;
  }
}

function simulateList(simulations) {
  return flatten(
    this.cmds.map((cmd, i) => cmd.simulate(simulations[i])).filter(a => a)
  );
}

function list(cmds, options = {}) {
  if (process.env.NODE_ENV !== 'production') {
    if (!options.testInvariants) {
      throwInvariant(
        Array.isArray(cmds) && cmds.every(isCmd),
        'Cmd.list: first argument to Cmd.list must be an array of other Cmds'
      );

      throwInvariant(
        typeof options === 'object',
        'Cmd.list: second argument to Cmd.list must be an options object'
      );
    }
  } else if (options.testInvariants) {
    throw Error(
      "Redux Loop: Detected usage of Cmd.list's testInvariants option in production code. This should only be used in tests."
    );
  }

  const { testInvariants, ...rest } = options;

  return Object.freeze({
    [isCmdSymbol]: true,
    type: cmdTypes.LIST,
    cmds,
    simulate: simulateList,
    ...rest
  });
}

function simulateMap(simulation) {
  let result = this.nestedCmd.simulate(simulation);
  if (Array.isArray(result)) {
    return result.map(action => this.tagger(...this.args, action));
  } else if (result) {
    return this.tagger(...this.args, result);
  } else {
    return null;
  }
}

function map(nestedCmd, tagger, ...args) {
  if (process.env.NODE_ENV !== 'production') {
    throwInvariant(
      isCmd(nestedCmd),
      'Cmd.map: first argument to Cmd.map must be another Cmd'
    );

    throwInvariant(
      typeof tagger === 'function',
      'Cmd.map: second argument to Cmd.map must be a function that returns an action'
    );
  }

  return Object.freeze({
    [isCmdSymbol]: true,
    type: cmdTypes.MAP,
    tagger,
    nestedCmd,
    args,
    simulate: simulateMap
  });
}

const none = Object.freeze({
  [isCmdSymbol]: true,
  type: cmdTypes.NONE,
  simulate: () => null
});

export default {
  run,
  action,
  setTimeout: setTimeoutCmd,
  setInterval: setIntervalCmd,
  clearTimeout: clearTimeoutCmd,
  clearInterval: clearIntervalCmd,
  list,
  map,
  none,
  dispatch: dispatchSymbol,
  getState: getStateSymbol
};
