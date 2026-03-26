import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { format, parseISO } from "date-fns";

function fmtCurrency(n: number): string {
  return "R " + n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ChartTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-background border rounded-lg shadow-sm px-3 py-2 text-sm space-y-0.5">
      <p className="font-medium">{format(parseISO(d.date), "dd MMM yyyy")}</p>
      <p className="text-muted-foreground capitalize">{d.status}</p>
      <p>{d.displayAmount > 0 ? fmtCurrency(d.displayAmount) : "No order"}</p>
    </div>
  );
}

export interface ChartEntry {
  id: string;
  date: string;
  status: string;
  displayAmount: number;
  amount: number;
  label: string;
}

interface CustomerChartProps {
  data: ChartEntry[];
  onBarClick: (entry: ChartEntry) => void;
}

export default function CustomerChart({ data, onBarClick }: CustomerChartProps) {
  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart
        data={data}
        onClick={(e) => e?.activePayload?.[0] && onBarClick(e.activePayload[0].payload)}
      >
        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
        <YAxis
          tickFormatter={(v) => `R ${v.toLocaleString("en-ZA")}`}
          tick={{ fontSize: 11 }}
          width={72}
        />
        <Tooltip content={<ChartTooltip />} />
        <Bar dataKey="amount" minPointSize={2} cursor="pointer">
          {data.map((entry) => (
            <Cell
              key={entry.id}
              fill={
                entry.status === "skipped"
                  ? "#ef4444"
                  : entry.displayAmount > 0
                  ? "#22c55e"
                  : "#f59e0b"
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
