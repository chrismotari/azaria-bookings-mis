// SVG files imported on native become components (see metro.config.js).
declare module '*.svg' {
  import { FC } from 'react';
  import { SvgProps } from 'react-native-svg';

  const content: FC<SvgProps>;
  export default content;
}
