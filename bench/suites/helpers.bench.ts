import { bench, do_not_optimize, group } from "mitata";
import {
  normalizeEmailAddress,
  normalizePersonName,
  parsePhoneNumber,
} from "../../lib";
import { sanitizeFilterValue } from "../../lib/helpers/sanitizeFilterValue";

// Per value helpers which run once for every scalar in a request, so they are
// multiplied by the size of the input.

group("scalars", () => {
  bench("normalizeEmailAddress", () => {
    do_not_optimize(normalizeEmailAddress("Jane.Doe+news@Example.COM"));
  });
  bench("normalizePersonName", () => {
    do_not_optimize(normalizePersonName("  jane   van der  doe "));
  });
  bench("parsePhoneNumber", () => {
    do_not_optimize(parsePhoneNumber("+49 30 901820"));
  });
});

group("filter input", () => {
  const where = {
    OR: Array.from({ length: 20 }, (_, i) => ({
      firstName: { like: `First${i}%` },
      lastName: { isNotNull: true },
      posts: { title: { ilike: `%${i}%` } },
    })),
  };
  bench("sanitizeFilterValue (20 branch where)", () => {
    do_not_optimize(sanitizeFilterValue(where));
  });
});
