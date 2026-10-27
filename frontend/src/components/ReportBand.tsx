export const CASE_STUDY = "https://scottcampbell.io/projects/grid-intelligence/";
export const REPO = "https://github.com/scottcampbelldata/grid-intelligence";

// Title band and summary aside, as on the scottcampbell.io project pages.
export function ReportBand() {
  return (
    <div className="report-band">
      <div className="report-band-inner">
        <div>
          <div className="report-kicker">Live energy analytics dashboard</div>
          <h1>Grid intelligence</h1>
          <p className="report-lead">
            A live view of the US and European electricity grids, built from
            public EIA, ENTSO-E and NOAA data. Demand, generation mix,
            interchange, forecasts, anomalies and data quality each have their
            own tab below.
          </p>
        </div>
        <dl className="glance" aria-label="Dashboard summary">
          <dt>The question</dt>
          <dd>Where is grid demand moving, and where is a closer look warranted?</dd>
          <dt>The data</dt>
          <dd>Public EIA, ENTSO-E and NOAA feeds, ingested on a schedule into a TimescaleDB warehouse and modeled with dbt.</dd>
          <dt>The read</dt>
          <dd>Figures move as new data lands, and the status line shows how fresh they are. <a href={CASE_STUDY}>Read the case study</a>.</dd>
        </dl>
      </div>
    </div>
  );
}
