// @ts-nocheck -- ported unchanged from the Deck Builder Pro repo, which type-checks under looser settings than this app.
type HolderStock = { decks: number; one: number; two: number; three: number };

/** Each spare larger holder supports one stage, not multiple single holders. */
export function allocateSingleDeckStages(quantity: number, stock: HolderStock, allowTwo = true) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > stock.decks) return null;
  const one = Math.min(quantity, stock.one);
  const two = Math.min(quantity - one, allowTwo ? stock.two : 0);
  const three = Math.min(quantity - one - two, stock.three);
  if (one + two + three !== quantity) return null;
  const capacities: (1 | 2 | 3)[] = [
    ...Array<1>(one).fill(1), ...Array<2>(two).fill(2), ...Array<3>(three).fill(3),
  ];
  return { capacities, usage: { decks: quantity, one, two, three } };
}