import {
    Line,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    ComposedChart,
} from "recharts";

import { useMemo } from "react";


interface TimeSeriesChartProps {
    data: Array<{
        date: string;
        views: number;
        visitors: number;
        bounceRate: number;
    }>;
    intervalType?: string;
}

function dateStringToLocalDateObj(dateString: string): Date {
    const date = new Date(dateString);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date;
}

function CustomTooltip(props: any) {
    const { active, payload, label } = props;

    const date = dateStringToLocalDateObj(label);

    const formattedDate = date.toLocaleString("en-us", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        timeZoneName: "short",
    });
    if (active && payload && payload.length) {
        return (
            <div className="chart-tooltip">
                <div className="chart-tooltip__date">{formattedDate}</div>
                <ul className="chart-tooltip__list">
                    <li>
                        <span
                            className="chart-tooltip__swatch"
                            style={{ background: CHART.visitors }}
                        />
                        {`${payload[1].value} visitors`}
                    </li>
                    <li>
                        <span
                            className="chart-tooltip__swatch"
                            style={{ background: CHART.views }}
                        />
                        {`${payload[0].value} views`}
                    </li>
                    <li>
                        <span
                            className="chart-tooltip__swatch"
                            style={{ background: CHART.bounce }}
                        />
                        {`${payload[2].value}% bounce rate`}
                    </li>
                </ul>
            </div>
        );
    } else {
        return null;
    }
}

/**
 * Chart colours, mirroring the CFDS tokens.
 *
 * These are literals rather than var(--brand-500) because recharts writes them
 * straight into SVG presentation attributes, where custom properties do not
 * resolve. Keep them in step with core-forms.css and the categorical palette
 * in core-forms-dashboard.css.
 */
const CHART = {
    views: "#8fadff", // --brand-300
    visitors: "#2f63f5", // --brand-500
    bounce: "#64748b", // --ink-500
    grid: "#e2e8f0", // --ink-200
    axis: "#64748b", // --ink-500
};

export default function TimeSeriesChart({
    data,
    intervalType,
}: TimeSeriesChartProps) {
    function xAxisDateFormatter(date: string): string {
        const dateObj = dateStringToLocalDateObj(date);

        switch (intervalType) {
            case "DAY":
                return dateObj.toLocaleDateString("en-us", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                });
            case "HOUR":
                return dateObj.toLocaleTimeString("en-us", {
                    hour: "numeric",
                    minute: "numeric",
                });
            default:
                throw new Error("Invalid interval type");
        }
    }

    const yAxisCountTicks = useMemo(() => {
        const MAX_TICKS_TO_SHOW = 4;

        // get the max integer value of data views
        const maxViews = Math.max(...data.map((item) => item.views));

        // determine the magnitude of maxViews to set rounding
        const magnitude = Math.floor(Math.log10(maxViews));
        const roundTo = Math.pow(10, Math.max(0, magnitude - 1));

        const numTicks = Math.min(MAX_TICKS_TO_SHOW, maxViews);
        const ticks = [];

        // calculate increment and round it up to the nearest roundTo
        let increment = Math.floor(maxViews / numTicks);
        increment = Math.ceil(increment / roundTo) * roundTo;

        // skip 0 and go 1 further
        for (let i = 1; i <= numTicks + 1; i++) {
            const tick = i * increment;

            ticks.push(tick);
        }

        return ticks;
    }, [data]);

    // omit first and last
    const xAxisTicks = useMemo(
        () => data.slice(1, -1).map((entry) => entry.date),
        [data],
    );

    // chart doesn't really work no data points, so just bail out
    if (data.length === 0) {
        return null;
    }

    return (
        <ResponsiveContainer width="100%" height="100%" minWidth={100}>
            <ComposedChart
                width={500}
                height={400}
                data={data}
                margin={{
                    top: 10,
                    right: 30,
                    left: 0,
                    bottom: 0,
                }}
            >
                <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                <XAxis
                    dataKey="date"
                    // tickLine={false}
                    tickMargin={8}
                    ticks={xAxisTicks}
                    tickFormatter={xAxisDateFormatter}
                    tick={{ fill: CHART.axis, fontSize: 12 }}
                />

                {/* manually setting maxViews vs using recharts "dataMax" key cause it doesnt seem to work */}
                <YAxis
                    yAxisId="count"
                    dataKey="views"
                    domain={[0, Math.max(...yAxisCountTicks)]} // set max Y value a little higher than what was recorded
                    tickLine={false}
                    tickMargin={5}
                    ticks={yAxisCountTicks}
                    tick={{ fill: CHART.axis, fontSize: 12 }}
                />
                <YAxis
                    yAxisId="bounceRate"
                    dataKey="bounceRate"
                    domain={[0, 120]}
                    hide={true}
                />

                <Tooltip content={<CustomTooltip />} />

                <Area
                    yAxisId="count"
                    dataKey="views"
                    stroke={CHART.views}
                    strokeWidth="2"
                    fill={CHART.views}
                    fillOpacity={0.35}
                />
                <Area
                    yAxisId="count"
                    dataKey="visitors"
                    stroke={CHART.visitors}
                    strokeWidth="2"
                    fill={CHART.visitors}
                    fillOpacity={0.18}
                />
                <Line
                    yAxisId="bounceRate"
                    dataKey="bounceRate"
                    stroke={CHART.bounce}
                    strokeWidth="1.5"
                    strokeDasharray="4 3"
                    dot={false}
                />
            </ComposedChart>
        </ResponsiveContainer>
    );
}
