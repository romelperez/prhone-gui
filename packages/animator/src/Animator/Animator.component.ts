import { FC, createElement, useState, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';

import {
  ENTERED,
  ENTERING,
  EXITED,
  EXITING,
  PARALLEL,
  STAGGER,
  SEQUENCE,
  AnimatorFlowValue,
  AnimatorFlow,
  AnimatorSettings,
  AnimatorSettingsDuration,
  AnimatorChildActivations,
  AnimatorRef,
  AnimatorDuration,
  AnimatorChildRef
} from '../constants';
import { makeScheduler } from '../utils/makeScheduler';
import { getChildrenNodesSequenceActivationTimes } from '../utils/getChildrenNodesSequenceActivationTimes';
import { getChildrenNodesStaggerActivationTimes } from '../utils/getChildrenNodesStaggerActivationTimes';
import { AnimatorContext } from '../AnimatorContext';
import { useAnimatorGeneral } from '../useAnimatorGeneral';
import { useAnimator } from '../useAnimator';

const ANIMATE_DEFAULT = true;
const DURATION_DEFAULT = Object.freeze({
  enter: 100,
  exit: 100,
  stagger: 25,
  delay: 0,
  offset: 0
});

const animatorEmptySettings: AnimatorSettings = {};
let classInstanceIdCounter = 0;

interface AnimatorProps {
  animator?: AnimatorSettings
}

const Animator: FC<AnimatorProps> = props => {
  const { animator = animatorEmptySettings, children } = props;

  const parentAnimatorGeneral = useAnimatorGeneral();
  const parentAnimator = useAnimator();

  // Since the expected boolean values applicable to the node are provided down
  // to the next child node, they are converted to booleans always to prevent
  // possible data leaking.

  const isParentAnimated = parentAnimator ? !!parentAnimator.animate : ANIMATE_DEFAULT;
  const animate = animator.animate !== undefined ? !!animator.animate : isParentAnimated;

  const root = parentAnimator ? !!animator.root : true;

  const merge = !root && !!animator.merge;

  const combine = !!animator.combine;

  const manager = animator.manager ?? PARALLEL;

  const [instanceId] = useState(() => classInstanceIdCounter++);

  const [scheduler] = useState(() => makeScheduler());

  // All the <Animator/> children non-root instances.
  const [childrenNodesMap] = useState<Map<number, AnimatorChildRef>>(() => new Map());

  const dynamicDuration = useRef<AnimatorSettingsDuration | undefined>(undefined);

  // This variable is supposed to be defined by the component using this
  // <Animator/>. It will contain the reference(s) to the actual HTML element(s)
  // to animate on the flow transitions and component lifecycles.
  const animateRefs = useRef<any[]>([]);

  // Since the animator data is passed to different contexts, if it were to be
  // a "useState", a stale version of the data would be passed. So this is a
  // "persistent animator data reference" across different contexts.
  // It must be the same as "publicAnimatorRef" for consistency.
  const _persistentAnimatorRef = useRef<AnimatorRef>(null);
  const getPersistentAnimatorRef = (): AnimatorRef => _persistentAnimatorRef.current as AnimatorRef;

  // It is initially empty to trigger an initial flow diff and call the
  // event callbacks in the first render.
  const previousAnimatorRef = useRef<AnimatorRef | null>();

  const createAnimatorRef = (providedFlowValue?: AnimatorFlowValue): AnimatorRef => {
    const oldAnimatorRef = getPersistentAnimatorRef();

    const duration: AnimatorDuration = Object.freeze({
      ...DURATION_DEFAULT,
      ...parentAnimatorGeneral?.duration,
      ...animator.duration,
      ...dynamicDuration.current
    });

    // The flow object is not directly updated.
    // It is always updated based on its next flow value.
    let newFlow: AnimatorFlow | undefined;
    if (!oldAnimatorRef) {
      const value = animate ? EXITED : ENTERED;
      const hasEntered = value === ENTERED;
      const hasExited = value === EXITED;
      newFlow = Object.freeze({ value, [value]: true, hasEntered, hasExited });
    }
    else {
      const value = providedFlowValue ?? oldAnimatorRef.flow.value;
      const hasEntered = oldAnimatorRef?.flow.hasEntered || value === ENTERED;
      const hasExited = oldAnimatorRef?.flow.hasExited || value === EXITED;
      newFlow = Object.freeze({ value: value, [value]: true, hasEntered, hasExited });
    }
    const flow: AnimatorFlow = newFlow;

    const setupAnimateRefs = (...refs: any[]): void => {
      animateRefs.current = refs;
    };
    const updateDuration = (newDynamicDuration: AnimatorSettingsDuration | undefined): void => {
      if (combine) {
        console.error('Animator can not update duration dynamically when "combine" is enabled.');
        return;
      }

      dynamicDuration.current = newDynamicDuration;

      updateAnimatorRef(createAnimatorRef());
    };

    const _id = instanceId;
    const _subscribe = (id: number, node: AnimatorChildRef): void => {
      childrenNodesMap.set(id, node);
      const { flow } = getPersistentAnimatorRef();
      node.setActivate(flow.value === ENTERING || flow.value === ENTERED);
    };
    const _unsubscribe = (id: number): void => {
      childrenNodesMap.delete(id);
    };

    return Object.freeze({
      animate,
      root,
      merge,
      combine,
      manager,
      duration,
      flow,
      setupAnimateRefs,
      updateDuration,
      _id,
      _subscribe,
      _unsubscribe
    });
  };

  // "_persistentAnimatorRef" and "publicAnimatorRef" must be the same data.
  // "_persistentAnimatorRef" is passed to different contexts to prevent
  // stale data since it is a "useRef". "publicAnimatorRef" is passed as provided
  // React context value to trigger renders.
  // Both values should be updated only with "updateAnimatorRef".
  if (!_persistentAnimatorRef.current) {
    const valueRef: any = _persistentAnimatorRef;
    valueRef.current = createAnimatorRef();
  }
  const [publicAnimatorRef, _setPublicAnimatorRef] = useState<AnimatorRef>(
    _persistentAnimatorRef.current as AnimatorRef
  );
  const updateAnimatorRef = (newAnimatorRef: AnimatorRef): void => {
    const valueRef: any = _persistentAnimatorRef;
    valueRef.current = newAnimatorRef;
    _setPublicAnimatorRef(newAnimatorRef);
  };

  const childActivations = useRef<AnimatorChildActivations | null>(null);

  const generateChildActivations = (flowValue: AnimatorFlowValue): void => {
    const animatorRef = getPersistentAnimatorRef();
    const { duration } = animatorRef;

    const nodes = Array.from(childrenNodesMap.values());
    let nodesToUpdate: AnimatorChildRef[] = [];

    // On EXITED, no nodes should be updated.

    if (combine) {
      nodesToUpdate = nodes;
    }
    else if (flowValue === ENTERING) {
      nodesToUpdate = nodes.filter(node => node.getIsMerge());
    }
    else if (flowValue === ENTERED) {
      nodesToUpdate = nodes.filter(node => !node.getIsMerge());
    }
    else if (flowValue === EXITING) {
      nodesToUpdate = nodes;
    }

    // On EXITING, all nodes exit at the same time in parallel.
    if (flowValue === EXITING || manager === PARALLEL) {
      // Since all the children will be transitioned in parallel, a possible
      // approach is to make the process synchronous so the scheduler only makes
      // one task. This becomes a bottle-neck if there are more animated nodes
      // than the machine CPU can handle and eventually block the thread.
      // So each node is transitioned separately to prevent this case.
      let totalDuration = 0;
      const times = nodesToUpdate.map(node => {
        totalDuration = Math.max(
          totalDuration,
          flowValue === EXITING ? node.getDuration().exit : node.getDuration().enter
        );
        return { node, time: 0 };
      });

      childActivations.current = { duration: totalDuration, times };
    }
    else if (flowValue === EXITED) {
      childActivations.current = { times: [] };
    }
    else if (manager === SEQUENCE) {
      childActivations.current = getChildrenNodesSequenceActivationTimes(nodesToUpdate);
    }
    else if (manager === STAGGER) {
      childActivations.current = getChildrenNodesStaggerActivationTimes(nodesToUpdate, duration);
    }
    else if (typeof manager === 'function') {
      childActivations.current = manager({ nodes: nodesToUpdate, duration });
    }
    else if (process.env.NODE_ENV !== 'production') {
      console.error(`Animator manager "${String(manager)}" is not supported.`);
    }
  };

  const generateActivationsDuration = (newFlowValue: AnimatorFlowValue): AnimatorDuration => {
    const animatorRef = getPersistentAnimatorRef();

    if (!combine) {
      return animatorRef.duration;
    }

    generateChildActivations(newFlowValue);

    if (
      process.env.NODE_ENV !== 'production' &&
      typeof manager === 'function' &&
      !childActivations.current?.duration &&
      childActivations.current?.times.length
    ) {
      console.error([
        'Animator with custom "manager" and "combine" enabled should return a child',
        'activations "duration". Otherwise the Animator duration will use the default',
        'value and it will not reflect the real combination of the durations.'
      ].join('\n'));
    }

    const durationChangedKey = newFlowValue === EXITING ? 'exit' : 'enter';
    const durationValueDefault = durationChangedKey === 'enter'
      ? animatorRef.duration.enter
      : animatorRef.duration.exit;
    const durationValue = childActivations.current?.duration || durationValueDefault;

    return { ...animatorRef.duration, [durationChangedKey]: durationValue };
  };

  const setFlowValue = (newFlowValue: AnimatorFlowValue): void => {
    if (!combine) {
      generateChildActivations(newFlowValue);
    }

    const newAnimatorRef = createAnimatorRef(newFlowValue);
    updateAnimatorRef(newAnimatorRef);
  };

  const setActivate = (activate: boolean): void => {
    const { flow } = getPersistentAnimatorRef();

    if (activate) {
      if (flow.value === ENTERING || flow.value === ENTERED) {
        return;
      }

      const duration = generateActivationsDuration(ENTERING);

      scheduler.start(duration.delay, () => {
        setFlowValue(ENTERING);
        scheduler.start(duration.enter, () => setFlowValue(ENTERED));
      });
    }
    else {
      if (flow.value === EXITING || flow.value === EXITED) {
        return;
      }

      const duration = generateActivationsDuration(EXITING);

      scheduler.start(0, () => {
        setFlowValue(EXITING);
        scheduler.start(duration.exit, () => setFlowValue(EXITED));
      });
    }
  };

  useEffect(() => {
    if (!animate) {
      return;
    }

    // TODO: What if node is changed from child node to root node and needs
    // to be unsuscribed from its parent?

    if (!root) {
      const id = instanceId;
      const getDuration = (): AnimatorDuration => getPersistentAnimatorRef().duration;
      const getIsMerge = (): boolean => getPersistentAnimatorRef().merge;
      const child: AnimatorChildRef = Object.freeze({
        id,
        getDuration,
        getIsMerge,
        setActivate
      });

      parentAnimator?._subscribe(instanceId, child);
    }

    animator.onAnimateMount?.(publicAnimatorRef, ...animateRefs.current);

    return () => {
      scheduler.stopAll();

      animator.onAnimateUnmount?.(publicAnimatorRef, ...animateRefs.current);

      if (!root) {
        parentAnimator?._unsubscribe(instanceId);
      }
    };
  }, []);

  useEffect(() => {
    if (!animate) {
      return;
    }

    const animatorRef = getPersistentAnimatorRef();
    const { flow } = animatorRef;

    // An animated root node is by default activated.
    if (root) {
      setActivate(animator.activate !== false);
    }

    const previousFlowValue = previousAnimatorRef.current?.flow.value;
    // If the flow value was changed in this update.
    if (previousFlowValue !== flow.value) {
      animator.onTransition?.(flow);

      switch (flow.value) {
        case ENTERING: animator.onAnimateEntering?.(animatorRef, ...animateRefs.current); break;
        case ENTERED:
          if (previousFlowValue && previousFlowValue !== ENTERING) {
            animator.onAnimateEntering?.(animatorRef, ...animateRefs.current);
          }
          animator.onAnimateEntered?.(animatorRef, ...animateRefs.current);
          break;
        case EXITING: animator.onAnimateExiting?.(animatorRef, ...animateRefs.current); break;
        case EXITED:
          if (previousFlowValue && previousFlowValue !== EXITING) {
            animator.onAnimateExiting?.(animatorRef, ...animateRefs.current);
          }
          animator.onAnimateExited?.(animatorRef, ...animateRefs.current);
          break;
      }

      if (childActivations.current?.times.length) {
        const newChildrenActivation = flow.value === ENTERING || flow.value === ENTERED;

        childActivations.current.times.forEach(({ node, time }) =>
          scheduler.start(node.id, time, () => node.setActivate(newChildrenActivation))
        );
      }
    }

    previousAnimatorRef.current = animatorRef;
  }, [parentAnimatorGeneral, parentAnimator, animator, publicAnimatorRef]);

  return createElement(AnimatorContext.Provider, { value: publicAnimatorRef }, children);
};

Animator.propTypes = {
  // @ts-expect-error
  animator: PropTypes.shape({
    duration: PropTypes.shape({
      enter: PropTypes.number,
      exit: PropTypes.number,
      stagger: PropTypes.number,
      delay: PropTypes.number,
      offset: PropTypes.number
    }),
    animate: PropTypes.bool,
    root: PropTypes.bool,
    merge: PropTypes.bool,
    combine: PropTypes.bool,
    manager: PropTypes.oneOfType([
      PropTypes.oneOf([PARALLEL, SEQUENCE, STAGGER]),
      PropTypes.func
    ]),
    onAnimateMount: PropTypes.func,
    onAnimateEntering: PropTypes.func,
    onAnimateEntered: PropTypes.func,
    onAnimateExiting: PropTypes.func,
    onAnimateExited: PropTypes.func,
    onAnimateUnmount: PropTypes.func,
    activate: PropTypes.bool,
    onTransition: PropTypes.func
  }),
  children: PropTypes.any
};

export { AnimatorProps, Animator };
