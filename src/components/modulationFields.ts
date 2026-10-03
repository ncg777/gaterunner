export interface ModulationField {
  key: string;
  label: string;
  kind?: 'switch';
  min?: number;
  max?: number;
  step?: number;
  items?: readonly (string | number | { title: string; value: string | number })[];
  disabled?: boolean;
}
