import { BlockCanvas } from "./BlockCanvas/BlockCanvas";

interface Props {
  onEditBlock: (streamName: string) => void;
}

export function PipelineChart({ onEditBlock }: Props) {
  return <BlockCanvas onEditBlock={onEditBlock} />;
}
