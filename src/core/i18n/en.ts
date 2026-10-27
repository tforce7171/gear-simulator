import type { MessageKey } from './ja';

// 英語の辞書。足りないキーも余分なキーも型エラーになる（design.md §8）
export const en = {
  'app.title': 'Gear Simulator',
  'toolbar.label': 'Toolbar',
  'toolbar.works': 'Works',
  'toolbar.works.tooltip': 'Open the list of saved works',
  'toolbar.save': 'Save',
  'toolbar.save.tooltip': 'Save as a work',
  'toolbar.export': 'Export',
  'toolbar.export.tooltip': 'Export to a JSON file',
  'toolbar.import': 'Import',
  'toolbar.import.tooltip': 'Import a JSON file',
  'toolbar.theme': 'Theme',
  'toolbar.theme.tooltip': 'Switch between brass and wood',
  'toolbar.info': 'Info',
  'toolbar.info.tooltip': 'Show or hide rpm, gear ratios and directions',
  'toolbar.mute': 'Mute',
  'toolbar.mute.tooltip': 'Mute or unmute the sound (M)',
  'toolbar.settings': 'Settings',
  'toolbar.settings.tooltip': 'Open the settings',
  'palette.title': 'Parts',
  'properties.title': 'Properties',
  'properties.empty': 'Select a part to see its settings here',
  'toast.close': 'Close',
} satisfies Record<MessageKey, string>;
