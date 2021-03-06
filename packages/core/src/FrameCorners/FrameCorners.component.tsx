/* @jsx jsx */
import { ReactNode, ReactElement } from 'react';
import PropTypes from 'prop-types';
import { cx } from '@emotion/css';
import { jsx, useTheme } from '@emotion/react';

import { BleepsOnAnimator } from '../utils/BleepsOnAnimator';
import { FRAME_SVG_POLYLINE_GENERIC, FrameSVGProps, FrameSVG } from '../FrameSVG';

interface FrameCornersProps extends FrameSVGProps {
  cornerWidth?: number
  cornerLength?: number
  showContentLines?: boolean
  contentLineWidth?: number
  children?: ReactNode
}

const FrameCorners = (props: FrameCornersProps): ReactElement => {
  const {
    className,
    cornerWidth,
    cornerLength,
    showContentLines,
    contentLineWidth,
    children,
    ...otherProps
  } = props;

  const theme = useTheme();
  const cw = theme.outline(cornerWidth);
  const cl = cornerLength as number;

  let contentPolylines: FRAME_SVG_POLYLINE_GENERIC[] = [];

  if (showContentLines) {
    const yAnimated = {
      initialStyles: { transform: 'scaleY(0)' },
      entering: { scaleY: 1 },
      exiting: { scaleY: 0 }
    };
    const xAnimated = {
      initialStyles: { transform: 'scaleX(0)' },
      entering: { scaleX: 1 },
      exiting: { scaleX: 0 }
    };

    contentPolylines = [
      {
        polyline: [[cw, cw], [cw, `100% - ${cw}`]],
        animated: yAnimated
      },
      {
        polyline: [[`100% - ${cw}`, cw], [`100% - ${cw}`, `100% - ${cw}`]],
        animated: yAnimated
      },
      {
        polyline: [[cw, cw], [`100% - ${cw}`, cw]],
        animated: xAnimated
      },
      {
        polyline: [[cw, `100% - ${cw}`], [`100% - ${cw}`, `100% - ${cw}`]],
        animated: xAnimated
      }
    ].map(contentLine => ({
      ...contentLine,
      lineWidth: theme.outline(contentLineWidth),
      css: { transformOrigin: 'center', opacity: 0.5 }
    }));
  }

  const cornerPolylines: FRAME_SVG_POLYLINE_GENERIC[] = [
    [[0, 0], [0, cl]],
    [[0, 0], [cl, 0]],
    [['100%', 0], [`100% - ${cl}`, 0]],
    [['100%', 0], ['100%', cl]],
    [['100%', '100%'], [`100% - ${cl}`, '100%']],
    [['100%', '100%'], ['100%', `100% - ${cl}`]],
    [[0, '100%'], [0, `100% - ${cl}`]],
    [[0, '100%'], [cl, '100%']]
  ].map(polyline => ({
    polyline,
    css: { strokeLinecap: 'square' }
  }));

  return (
    <FrameSVG
      {...otherProps}
      className={cx('arwes-frame-corners', className)}
      shapes={[
        [
          [cw, cw],
          [cw, `100% - ${cw}`],
          [`100% - ${cw}`, `100% - ${cw}`],
          [`100% - ${cw}`, cw]
        ]
      ]}
      polylines={[
        ...contentPolylines,
        ...cornerPolylines
      ]}
      lineWidth={cw}
    >
      <BleepsOnAnimator
        entering={{ name: 'assemble', loop: true }}
        exiting={{ name: 'assemble', loop: true }}
      />
      {children}
    </FrameSVG>
  );
};

FrameCorners.propTypes = {
  cornerWidth: PropTypes.number,
  cornerLength: PropTypes.number,
  showContentLines: PropTypes.bool,
  contentLineWidth: PropTypes.number,
  children: PropTypes.any
};

FrameCorners.defaultProps = {
  cornerWidth: 1,
  cornerLength: 10,
  contentLineWidth: 1
};

export { FrameCornersProps, FrameCorners };
