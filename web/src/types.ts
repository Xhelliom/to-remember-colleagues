export type User = {
  id: string;
  email: string;
  name: string;
};

export type Company = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: string;
  graveCount: number;
};

export type Colleague = {
  id: string;
  name: string;
  quote: string;
  departedOn: string | null;
  graveSeed: number;
  createdAt: string;
};

export type CompanyDetail = {
  company: Omit<Company, "graveCount">;
  colleagues: Colleague[];
};
