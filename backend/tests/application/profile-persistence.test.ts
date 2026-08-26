/**
 * CAPUCINE — persistance réelle du profil utilisateur
 *
 * Le test essentiel de ce fichier est celui qui écrit, DÉTRUIT l'instance du
 * store, en recrée une neuve, et relit. Un store en mémoire déguisé le
 * échouerait : c'est ce qui distingue une persistance d'un cache.
 */
import { mkdtemp, rm, writeFile, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileProfileStore, createEmptyProfile } from '../../src/application/profile-store';
import type { PreferenceCriterion } from '../../src/domain/types';

const criterion = (id: string, name: string, level: PreferenceCriterion['level']): PreferenceCriterion =>
  ({ id, name, level });

describe('FileProfileStore — persistance réelle', () => {
  let dir: string;

  beforeEach(async () => {
    // Chaque test a son propre répertoire : aucun test ne dépend d'un autre,
    // et aucun ne touche les profils réels.
    dir = await mkdtemp(path.join(tmpdir(), 'capucine-profiles-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("LE TEST ESSENTIEL : les données survivent à la destruction du store", async () => {
    const first = new FileProfileStore(dir);
    await first.updateCriterion('benjamin', criterion('livraison-fr', 'Livraison en France', 'important'));
    await first.updateCriterion('benjamin', criterion('budget', 'Budget maîtrisé', 'very_important'));

    // L'instance disparaît complètement — plus aucune mémoire de processus.
    const second = new FileProfileStore(dir);
    const reloaded = await second.load('benjamin');

    expect(reloaded.userId).toBe('benjamin');
    expect(reloaded.preferences.criteria.map(c => c.id).sort()).toEqual(['budget', 'livraison-fr']);
    const budget = reloaded.preferences.criteria.find(c => c.id === 'budget')!;
    expect(budget.name).toBe('Budget maîtrisé');
    expect(budget.level).toBe('very_important');
    // Les dates redeviennent de vraies Date, pas des chaînes.
    expect(reloaded.updatedAt).toBeInstanceOf(Date);
    expect(Number.isNaN(reloaded.updatedAt.getTime())).toBe(false);
  });

  it("l'ordre des préférences est conservé après rechargement", async () => {
    const store = new FileProfileStore(dir);
    for (const [id, name] of [['a', 'Premier'], ['b', 'Deuxième'], ['c', 'Troisième']]) {
      await store.updateCriterion('u', criterion(id, name, 'preference'));
    }
    const reloaded = await new FileProfileStore(dir).load('u');
    expect(reloaded.preferences.criteria.map(c => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('une préférence modifiée est remplacée, jamais dupliquée', async () => {
    const store = new FileProfileStore(dir);
    await store.updateCriterion('u', criterion('budget', 'Budget', 'preference'));
    await store.updateCriterion('u', criterion('budget', 'Budget strict', 'required'));

    const reloaded = await new FileProfileStore(dir).load('u');
    expect(reloaded.preferences.criteria.length).toBe(1);
    expect(reloaded.preferences.criteria[0].name).toBe('Budget strict');
    expect(reloaded.preferences.criteria[0].level).toBe('required');
  });

  it('une suppression est durable', async () => {
    const store = new FileProfileStore(dir);
    await store.updateCriterion('u', criterion('x', 'X', 'important'));
    await store.removeCriterion('u', 'x');

    const reloaded = await new FileProfileStore(dir).load('u');
    expect(reloaded.preferences.criteria).toEqual([]);
  });

  it('delete() efface durablement le profil entier', async () => {
    const store = new FileProfileStore(dir);
    await store.updateCriterion('u', criterion('x', 'X', 'important'));
    expect(await store.exists('u')).toBe(true);

    await store.delete('u');
    const fresh = new FileProfileStore(dir);
    expect(await fresh.exists('u')).toBe(false);
    expect((await fresh.load('u')).preferences.criteria).toEqual([]);
  });

  it('deux utilisateurs sont réellement isolés', async () => {
    const store = new FileProfileStore(dir);
    await store.updateCriterion('alice', criterion('a', 'Pour Alice', 'important'));
    await store.updateCriterion('bob', criterion('b', 'Pour Bob', 'low'));

    const fresh = new FileProfileStore(dir);
    expect((await fresh.load('alice')).preferences.criteria.map(c => c.id)).toEqual(['a']);
    expect((await fresh.load('bob')).preferences.criteria.map(c => c.id)).toEqual(['b']);
    // Supprimer l'un ne touche pas l'autre.
    await fresh.delete('alice');
    expect((await new FileProfileStore(dir).load('bob')).preferences.criteria.length).toBe(1);
  });

  it('un profil inexistant reste inexistant — il n’est pas créé par une lecture', async () => {
    const store = new FileProfileStore(dir);
    const profile = await store.load('jamais-vu');

    expect(profile.preferences.criteria).toEqual([]);
    expect(await store.exists('jamais-vu')).toBe(false);
    // Aucune lecture n'a écrit sur le disque.
    await mkdir(dir, { recursive: true });
    expect(await readdir(dir)).toEqual([]);
  });

  it('un identifiant tordu ne peut pas écrire hors du répertoire', async () => {
    const store = new FileProfileStore(dir);
    await store.updateCriterion('../../evil', criterion('x', 'X', 'important'));

    // Le nom de fichier étant un hash, il ne peut contenir aucun séparateur :
    // tout reste dans le répertoire, et rien n'est écrit au-dessus.
    const files = await readdir(dir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^[0-9a-f]{64}\.json$/);
    // Et la donnée reste relisible sous cet identifiant exact.
    expect((await new FileProfileStore(dir).load('../../evil')).preferences.criteria.length).toBe(1);
  });

  it('un fichier corrompu LÈVE une erreur au lieu de prétendre que le profil est vide', async () => {
    const store = new FileProfileStore(dir);
    await store.updateCriterion('u', criterion('x', 'X', 'important'));

    // On corrompt le fichier réellement écrit.
    const [file] = await readdir(dir);
    await writeFile(path.join(dir, file), '{ ceci n est pas du JSON', 'utf8');

    // Renvoyer un profil vide ici effacerait les préférences au prochain save.
    await expect(new FileProfileStore(dir).load('u')).rejects.toThrow();
  });

  it('un fichier structurellement invalide est refusé, pas silencieusement vidé', async () => {
    const store = new FileProfileStore(dir);
    await store.updateCriterion('u', criterion('x', 'X', 'important'));
    const [file] = await readdir(dir);
    await writeFile(path.join(dir, file), JSON.stringify({ userId: 'u' }), 'utf8');

    await expect(new FileProfileStore(dir).load('u')).rejects.toThrow(/criteria/i);
  });

  it('des écritures concurrentes sur le même utilisateur ne se perdent pas', async () => {
    const store = new FileProfileStore(dir);
    // Sans sérialisation par utilisateur, ce read-modify-write concurrent
    // ferait gagner le dernier écrivain et perdrait les autres préférences.
    await Promise.all([
      store.updateCriterion('u', criterion('a', 'A', 'important')),
      store.updateCriterion('u', criterion('b', 'B', 'important')),
      store.updateCriterion('u', criterion('c', 'C', 'important')),
    ]);

    const reloaded = await new FileProfileStore(dir).load('u');
    expect(reloaded.preferences.criteria.map(c => c.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('save() persiste un profil complet construit ailleurs', async () => {
    const store = new FileProfileStore(dir);
    const profile = createEmptyProfile('u');
    profile.preferences.criteria.push(criterion('z', 'Z', 'required'));
    await store.save(profile);

    const reloaded = await new FileProfileStore(dir).load('u');
    expect(reloaded.preferences.criteria.map(c => c.id)).toEqual(['z']);
  });
});
