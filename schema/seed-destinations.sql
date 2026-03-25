-- WanderSafe Seed Destinations
-- Inserts baseline destination rows for the 10 tracked cities + their countries.
-- Uses INSERT OR IGNORE to be safely re-runnable.

INSERT OR IGNORE INTO destinations (country_code, city, country, region, created_at) VALUES
  ('ES', NULL, 'Spain', 'Europe', CURRENT_TIMESTAMP),
  ('ES', 'Madrid', 'Spain', 'Europe', CURRENT_TIMESTAMP),
  ('ES', 'Barcelona', 'Spain', 'Europe', CURRENT_TIMESTAMP),
  ('MX', NULL, 'Mexico', 'North America', CURRENT_TIMESTAMP),
  ('MX', 'Puerto Vallarta', 'Mexico', 'North America', CURRENT_TIMESTAMP),
  ('PL', NULL, 'Poland', 'Europe', CURRENT_TIMESTAMP),
  ('PL', 'Krakow', 'Poland', 'Europe', CURRENT_TIMESTAMP),
  ('RW', NULL, 'Rwanda', 'Africa', CURRENT_TIMESTAMP),
  ('IT', NULL, 'Italy', 'Europe', CURRENT_TIMESTAMP),
  ('IT', 'Rome', 'Italy', 'Europe', CURRENT_TIMESTAMP),
  ('DE', NULL, 'Germany', 'Europe', CURRENT_TIMESTAMP),
  ('DE', 'Berlin', 'Germany', 'Europe', CURRENT_TIMESTAMP),
  ('NL', NULL, 'Netherlands', 'Europe', CURRENT_TIMESTAMP),
  ('NL', 'Amsterdam', 'Netherlands', 'Europe', CURRENT_TIMESTAMP),
  ('TH', NULL, 'Thailand', 'Asia', CURRENT_TIMESTAMP),
  ('TH', 'Bangkok', 'Thailand', 'Asia', CURRENT_TIMESTAMP),
  ('AR', NULL, 'Argentina', 'South America', CURRENT_TIMESTAMP),
  ('AR', 'Buenos Aires', 'Argentina', 'South America', CURRENT_TIMESTAMP);
