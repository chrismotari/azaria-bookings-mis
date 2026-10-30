import { PressableStateCallbackType } from 'react-native';

/** react-native-web also reports hover and keyboard focus to Pressable's style callback. */
export type PressState = PressableStateCallbackType & { hovered?: boolean; focused?: boolean };
