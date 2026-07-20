-- Seed categories from the Dinner & Awards Night flyer
-- Note: "Brand of the Year" and "Finalists of the Year" appeared twice on the flyer — deduped here.
-- Confirm with client if "Finalists of the Year" was meant to be a distinct award or a section label.

INSERT INTO categories (name) VALUES
('Brand of the Year'),
('Finalists of the Year'),
('Fresher of the Year'),
('Male Player of the Year'),
('Female Player of the Year'),
('Entrepreneur of the Year'),
('Student Activist of the Year'),
('Most Social Student of the Year'),
('Political Personality of the Year'),
('Best Optional Course Rep of the Year'),
('Ambassador of the Department'),
('Icon of the Year'),
('Biggest Baller of the Year'),
('Mr Personality of the Year'),
('Miss Personality of the Year'),
('General Course Rep of the Year'),
('Best Online Vendor of the Year'),
('Legislative Icon of the Year'),
('Best Dressed Female of the Year'),
('Most Influential Student of the Year'),
('Best Dressed Male Student of the Year'),
('Content Creator of the Year'),
('Dancer of the Year')
ON CONFLICT (name) DO NOTHING;
