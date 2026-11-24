const modes = ["crush", "selective"];
export const serviceItems = [["cable", "피복 폐전선"], ["copperPipe", "동관"]];

export function ifcServiceInventory(entries) {
  return Object.fromEntries(serviceItems.map(([kind]) => {
    const scoped = entries.filter(entry => entry.kind === kind);
    const measured = scoped.filter(entry => Number.isFinite(entry.tons) && entry.tons >= 0);
    return [kind, { kg: measured.length ? 1000 * measured.reduce((sum, entry) => sum + entry.tons, 0) : null,
      knownCount: measured.length, unknownCount: scoped.length - measured.length }];
  }));
}

export function identifyIfcServices(classified, entries) {
  const measured = new Map(entries.filter(entry => Number.isFinite(entry.tons) && entry.tons >= 0)
    .map(entry => [entry.expressID, entry]));
  const components = new Set([...measured.values()].flatMap(entry => (entry.replaces ?? []).filter(id => id !== entry.expressID)));
  function withService(el, entry) {
    const stream = entry.kind === "cable" ? "mixed" : "copper";
    return { ...el, tons: entry.tons, stream, serviceKind: entry.kind, guessed: false,
      parts: [{ cls: stream, stream, tons: entry.tons, m3: 0 }] };
  }
  const result = classified.filter(el => !components.has(el.expressID)).map(el => {
    const entry = measured.get(el.expressID);
    if (!entry) return el;
    measured.delete(el.expressID);
    return withService(el, entry);
  });
  for (const entry of measured.values()) {
    result.push(withService({ ...entry, area: 0, volume: 0, layers: [] }, entry));
  }
  return result;
}

export function serviceSalvage(q, p) {
  if (!q.serviceInventory) return null;
  const suffix = q.serviceProfile === "home" ? "home" : "nonres";
  return Object.fromEntries(serviceItems.map(([kind]) => {
    const cable = kind === "cable";
    const model = q.serviceInventory[kind];
    const entered = cable ? q.cableInstalled : q.pipeInstalled;
    const manual = cable
      ? [q.cableCrush ?? q.cableCommon, q.cableSel ?? q.cableCommon]
      : [q.copperPipeSold, q.copperPipeSold];
    const estimatedRate = q.officeRecovery
      ? p[cable ? "office_cable_kg_per_m2" : "office_pipe_kg_per_m2"]
      : p[`service_${cable ? "cable" : "pipe"}_${suffix}`];
    const canEstimate = Boolean(q.serviceProfile && q.area_m2 > 0 && estimatedRate > 0
      && (cable || !(q.copperModeledTons > 0)));
    const source = entered != null ? "input" : model.kg != null ? "ifc" : canEstimate ? "area" : null;
    const kg = entered != null ? entered * 1000 : model.kg ?? (canEstimate ? q.area_m2 * estimatedRate : null);
    const treatmentKg = model.kg == null ? null : kg;
    const price = cable ? (q.cablePrice == null ? p.price_waste_cable : q.cablePrice / 1000) : p.price_copper_pipe;
    const exposed = cable ? p.office_cable_exposed : p.office_pipe_exposed;
    const methods = Object.fromEntries(modes.map((mode, index) => {
      const rate = exposed * p.service_exposed_recovery + (1 - exposed) * p[`service_embedded_${mode}`];
      const confirmed = manual[index] != null;
      const soldKg = confirmed ? manual[index] * 1000 : kg == null ? null : kg * rate;
      const residueKg = treatmentKg == null ? 0 : Math.max(0, treatmentKg - soldKg);
      const overInstalled = confirmed && source === "input" && soldKg > kg;
      return [mode, { rate, soldKg, confirmed, residueKg, overInstalled, revenue: (soldKg ?? 0) * price }];
    }));
    return [kind, { kg, source, price, treatmentKg, areaRate: source === "area" ? estimatedRate : null, model, methods }];
  }));
}
