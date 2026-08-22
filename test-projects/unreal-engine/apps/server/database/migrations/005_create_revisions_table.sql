-- Create revisions table
CREATE TABLE IF NOT EXISTS revisions (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  asset_id INTEGER REFERENCES assets(id) ON DELETE CASCADE,
  scene_id INTEGER REFERENCES scenes(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL,
  revision_type VARCHAR(50) NOT NULL, -- 'project', 'asset', 'scene'
  data_location TEXT, -- URL or path to the revision data
  metadata JSONB,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_revisions_project_id ON revisions(project_id);
CREATE INDEX idx_revisions_asset_id ON revisions(asset_id);
CREATE INDEX idx_revisions_scene_id ON revisions(scene_id);
CREATE INDEX idx_revisions_created_by ON revisions(created_by);
CREATE INDEX idx_revisions_created_at ON revisions(created_at);