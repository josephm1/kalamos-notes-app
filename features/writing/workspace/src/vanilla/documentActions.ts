/** Host-defined document commands; the workspace owns their shared small-menu presentation. */
export type DocumentAction<Args extends unknown[] = []> = {
  label: string;
  shortLabel?: string;
  icon?: string;
  onPress?: (...args: Args) => boolean;
  run?: (...args: Args) => void;
  options?: DocumentAction<Args>[];
};
